const express=require('express'),multer=require('multer'),path=require('path'),fs=require('fs');
const {db}=require('../database'),{requireLogin,requireRole}=require('../middleware/auth'),{sendMail}=require('../mailer');
const r=express.Router();

// Setup multer
const storage=multer.diskStorage({
  destination:(req,file,cb)=>{
    const dir=path.join(__dirname,'../public/uploads');
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    cb(null,dir);
  },
  filename:(req,file,cb)=>{
    const ext=path.extname(file.originalname);
    cb(null,`sub_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload=multer({storage,limits:{fileSize:10*1024*1024}});

const names=(tasks,users)=>tasks.map(t=>({...t,assignee_name:(users.find(u=>u.id===t.assignee_id)||{}).name||null}));

r.get('/stats',requireLogin,(req,res)=>{
  const{tasks}=db.get(),today=new Date().toISOString().split('T')[0];
  const mine=req.session.user.role==='karyawan'?tasks.filter(t=>t.assignee_id===req.session.user.id):tasks;
  res.json({total:mine.length,done:mine.filter(t=>t.status==='done').length,
    inprogress:mine.filter(t=>t.status==='inprogress').length,
    overdue:mine.filter(t=>t.deadline&&t.deadline<today&&t.status!=='done').length});
});

r.get('/',requireLogin,(req,res)=>{
  const d=db.get();
  const tasks=req.session.user.role==='karyawan'?d.tasks.filter(t=>t.assignee_id===req.session.user.id):d.tasks;
  res.json(names([...tasks].reverse(),d.users));
});

r.post('/',requireRole('manager'),(req,res)=>{
  const{title,description,assignee_id,priority,deadline}=req.body;
  if(!title)return res.status(400).json({error:'Judul wajib diisi'});
  const d=db.get(),id=db.nextId('tasks');
  const task={id,title,description:description||'',assignee_id:parseInt(assignee_id)||null,
    created_by:req.session.user.id,priority:priority||'med',status:'todo',
    deadline:deadline||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  d.tasks.push(task);
  const assignee=d.users.find(u=>u.id===parseInt(assignee_id));
  if(assignee){
    const nid=db.nextId('notifications');
    d.notifications.push({id:nid,user_id:assignee.id,message:`Tugas baru: "${title}"`,type:'info',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(assignee.email,`[FlowDesk] Tugas Baru: ${title}`,
      `<h3>Halo ${assignee.name},</h3><p>Tugas baru ditetapkan untukmu:</p>
      <p><b>Judul:</b> ${title}</p><p><b>Prioritas:</b> ${priority}</p>
      <p><b>Deadline:</b> ${deadline||'-'}</p><p><b>Deskripsi:</b> ${description||'-'}</p>`);
  } else {db.save(d);}
  res.json(task);
});

// Update status dengan submission
r.patch('/:id/status',requireLogin,upload.single('file'),(req,res)=>{
  const{status,note}=req.body;
  if(!['todo','inprogress','review','done'].includes(status))
    return res.status(400).json({error:'Status tidak valid'});
  const d=db.get(),idx=d.tasks.findIndex(t=>t.id===parseInt(req.params.id));
  if(idx===-1)return res.status(404).json({error:'Tidak ditemukan'});
  const task=d.tasks[idx],user=req.session.user;
  if(user.role==='karyawan'&&task.assignee_id!==user.id)
    return res.status(403).json({error:'Bukan tugasmu'});

  // Simpan submission
  if(note||(req.file&&status!=='todo')){
    const sid=db.nextId('submissions');
    const sub={
      id:sid,task_id:parseInt(req.params.id),task_title:task.title,
      user_id:user.id,user_name:user.name,
      status_change:`${task.status} → ${status}`,
      note:note||'',
      file:req.file?`/uploads/${req.file.filename}`:null,
      file_name:req.file?req.file.originalname:null,
      created_at:new Date().toISOString()
    };
    d.submissions.push(sub);
  }

  d.tasks[idx]={...task,status,updated_at:new Date().toISOString()};
  const sLabel={todo:'To Do',inprogress:'In Progress',review:'Review',done:'Selesai'};
  const manager=d.users.find(u=>u.role==='manager');
  if(manager&&manager.id!==user.id){
    const nid=db.nextId('notifications');
    d.notifications.push({id:nid,user_id:manager.id,
      message:`${user.name} mengubah "${task.title}" → ${sLabel[status]}`,
      type:'success',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(manager.email,`[FlowDesk] Update: ${task.title}`,
      `<h3>Halo Manager,</h3><p><b>${user.name}</b> mengubah status tugas <b>"${task.title}"</b> menjadi <b>${sLabel[status]}</b>.</p>
      ${note?`<p><b>Catatan:</b> ${note}</p>`:''}
      ${req.file?`<p><b>Bukti:</b> File telah diupload</p>`:''}`);
  } else {db.save(d);}
  res.json({success:true});
});

r.delete('/:id',requireRole('manager'),(req,res)=>{
  const d=db.get();
  d.tasks=d.tasks.filter(t=>t.id!==parseInt(req.params.id));
  db.save(d);res.json({success:true});
});

// GET submissions per tugas
r.get('/:id/submissions',requireLogin,(req,res)=>{
  const d=db.get();
  const subs=d.submissions.filter(s=>s.task_id===parseInt(req.params.id));
  res.json(subs);
});

// GET semua submissions (manager)
r.get('/all/submissions',requireRole('manager'),(req,res)=>{
  const d=db.get();
  res.json([...d.submissions].reverse());
});

module.exports=r;

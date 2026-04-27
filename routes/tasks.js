const express=require('express'),multer=require('multer'),path=require('path'),fs=require('fs');
const {db}=require('../database');
const {requireLogin,requireRole}=require('../middleware/auth');
const {sendMail}=require('../mailer');
const r=express.Router();

const storage=multer.diskStorage({
  destination:(req,file,cb)=>{
    const dir=path.join(__dirname,'../public/uploads');
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    cb(null,dir);
  },
  filename:(req,file,cb)=>cb(null,`sub_${Date.now()}${path.extname(file.originalname)}`)
});
const upload=multer({storage,limits:{fileSize:10*1024*1024}});

function enrichTask(task,d){
  const grp=d.task_groups.find(g=>g.task_id===task.id);
  const assigneeName=(d.users.find(u=>u.id===task.assignee_id)||{}).name||null;
  if(grp){
    return{...task,assignee_name:assigneeName,is_group:true,group_id:grp.id,
      group_name:grp.name,pic_id:grp.pic_id,
      pic_name:(d.users.find(u=>u.id===grp.pic_id)||{}).name||'—',
      member_ids:grp.members,
      member_names:grp.members.map(mid=>(d.users.find(u=>u.id===mid)||{}).name||'?')};
  }
  return{...task,assignee_name:assigneeName,is_group:false};
}

r.get('/stats',requireLogin,(req,res)=>{
  const d=db.get();
  const today=new Date().toISOString().split('T')[0];
  const uid=req.session.user.id,role=req.session.user.role;
  let tasks=role==='manager'?d.tasks:d.tasks.filter(t=>{
    if(t.assignee_id===uid)return true;
    const g=d.task_groups.find(g=>g.task_id===t.id);
    return g&&(g.pic_id===uid||g.members.includes(uid));
  });
  res.json({total:tasks.length,done:tasks.filter(t=>t.status==='done').length,
    inprogress:tasks.filter(t=>t.status==='inprogress').length,
    overdue:tasks.filter(t=>t.deadline&&t.deadline<today&&t.status!=='done').length});
});

r.get('/all/submissions',requireRole('manager'),(req,res)=>{
  const d=db.get();
  res.json([...d.submissions].reverse());
});

r.get('/',requireLogin,(req,res)=>{
  const d=db.get();
  const uid=req.session.user.id,role=req.session.user.role;
  let tasks=role==='manager'?d.tasks:d.tasks.filter(t=>{
    if(t.assignee_id===uid)return true;
    const g=d.task_groups.find(g=>g.task_id===t.id);
    return g&&(g.pic_id===uid||g.members.includes(uid));
  });
  res.json([...tasks].reverse().map(t=>enrichTask(t,d)));
});

r.post('/',requireRole('manager'),(req,res)=>{
  const{title,description,assignee_id,priority,deadline}=req.body;
  if(!title)return res.status(400).json({error:'Judul wajib diisi'});
  const d=db.get();
  const id=db.nextId('tasks');
  const task={id,title,description:description||'',assignee_id:parseInt(assignee_id)||null,
    created_by:req.session.user.id,priority:priority||'med',status:'todo',
    deadline:deadline||null,task_type:'individual',
    created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  d.tasks.push(task);
  const assignee=d.users.find(u=>u.id===parseInt(assignee_id));
  if(assignee){
    d.notifications.push({id:db.nextId('notifications'),user_id:assignee.id,
      message:`Tugas baru: "${title}"`,type:'info',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(assignee.email,`[FlowDesk] Tugas Baru: ${title}`,`<p>Halo ${assignee.name}, kamu mendapat tugas baru: <b>${title}</b></p>`);
  }else{db.save(d);}
  res.json(enrichTask(task,d));
});

r.post('/group',requireRole('manager'),(req,res)=>{
  const{title,description,priority,deadline,group_name,pic_id,member_ids}=req.body;
  if(!title)return res.status(400).json({error:'Judul wajib diisi'});
  if(!pic_id)return res.status(400).json({error:'PIC wajib dipilih'});
  const members=Array.isArray(member_ids)?member_ids.map(Number):[parseInt(member_ids)];
  if(!members.includes(parseInt(pic_id)))members.push(parseInt(pic_id));
  const d=db.get();
  const tid=db.nextId('tasks');
  const task={id:tid,title,description:description||'',assignee_id:null,
    created_by:req.session.user.id,priority:priority||'med',status:'todo',
    deadline:deadline||null,task_type:'group',
    created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  d.tasks.push(task);
  const gid=db.nextId('task_groups');
  d.task_groups.push({id:gid,task_id:tid,name:group_name||title,pic_id:parseInt(pic_id),members,created_at:new Date().toISOString()});
  db.save(d);
  members.forEach(mid=>{
    const u=d.users.find(u=>u.id===mid);
    if(u){
      const isPic=mid===parseInt(pic_id);
      d.notifications.push({id:db.nextId('notifications'),user_id:mid,
        message:`Tugas group "${title}" — kamu sebagai ${isPic?'PIC':'Anggota'}`,
        type:'info',is_read:0,created_at:new Date().toISOString()});
      db.save(d);
      sendMail(u.email,`[FlowDesk] Tugas Group: ${title}`,
        `<p>Halo ${u.name}, kamu ditambahkan ke tugas group <b>${title}</b> sebagai <b>${isPic?'PIC':'Anggota'}</b>.</p>`);
    }
  });
  res.json(enrichTask(task,d));
});

r.patch('/:id/status',requireLogin,upload.single('file'),(req,res)=>{
  const{status,note}=req.body;
  if(!['todo','inprogress','review','done'].includes(status))
    return res.status(400).json({error:'Status tidak valid'});
  const d=db.get();
  const idx=d.tasks.findIndex(t=>t.id===parseInt(req.params.id));
  if(idx===-1)return res.status(404).json({error:'Tidak ditemukan'});
  const task=d.tasks[idx],user=req.session.user;
  const grp=d.task_groups.find(g=>g.task_id===task.id);
  if(user.role!=='manager'){
    if(grp){if(grp.pic_id!==user.id)return res.status(403).json({error:'Hanya PIC yang bisa update status'});}
    else{if(task.assignee_id!==user.id)return res.status(403).json({error:'Bukan tugasmu'});}
  }
  if(note||(req.file&&status!=='todo')){
    d.submissions.push({id:db.nextId('submissions'),task_id:parseInt(req.params.id),
      task_title:task.title,user_id:user.id,user_name:user.name,
      status_change:`${task.status} → ${status}`,note:note||'',
      file:req.file?`/uploads/${req.file.filename}`:null,
      file_name:req.file?req.file.originalname:null,
      created_at:new Date().toISOString()});
  }
  d.tasks[idx]={...task,status,updated_at:new Date().toISOString()};
  const sLabel={todo:'To Do',inprogress:'In Progress',review:'Review',done:'Selesai'};
  const manager=d.users.find(u=>u.role==='manager');
  if(manager&&manager.id!==user.id){
    d.notifications.push({id:db.nextId('notifications'),user_id:manager.id,
      message:`${user.name} update "${task.title}" → ${sLabel[status]}`,
      type:'success',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(manager.email,`[FlowDesk] Update: ${task.title}`,
      `<p>${user.name} mengubah status <b>${task.title}</b> → <b>${sLabel[status]}</b>${note?`<br>Catatan: ${note}`:''}</p>`);
  }else{db.save(d);}
  if(grp){
    grp.members.filter(mid=>mid!==user.id&&mid!==manager?.id).forEach(mid=>{
      const dd=db.get();
      dd.notifications.push({id:db.nextId('notifications'),user_id:mid,
        message:`${user.name} update "${task.title}" → ${sLabel[status]}`,
        type:'info',is_read:0,created_at:new Date().toISOString()});
      db.save(dd);
    });
  }
  res.json({success:true});
});

r.post('/:id/comment',requireLogin,(req,res)=>{
  const{comment}=req.body;
  if(!comment||!comment.trim())return res.status(400).json({error:'Komentar kosong'});
  const d=db.get();
  const task=d.tasks.find(t=>t.id===parseInt(req.params.id));
  if(!task)return res.status(404).json({error:'Tidak ditemukan'});
  const c={id:db.nextId('task_comments'),task_id:parseInt(req.params.id),
    user_id:req.session.user.id,user_name:req.session.user.name,
    comment:comment.trim(),created_at:new Date().toISOString()};
  d.task_comments.push(c);db.save(d);
  res.json(c);
});

r.get('/:id/comments',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.task_comments.filter(c=>c.task_id===parseInt(req.params.id)));
});

r.get('/:id/submissions',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.submissions.filter(s=>s.task_id===parseInt(req.params.id)));
});

r.delete('/:id',requireRole('manager'),(req,res)=>{
  const d=db.get();
  d.tasks=d.tasks.filter(t=>t.id!==parseInt(req.params.id));
  d.task_groups=d.task_groups.filter(g=>g.task_id!==parseInt(req.params.id));
  db.save(d);res.json({success:true});
});

module.exports=r;

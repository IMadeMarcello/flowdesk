const express=require('express'),multer=require('multer'),path=require('path'),fs=require('fs');
const {db}=require('../database'),{requireLogin,requireRole}=require('../middleware/auth'),{sendMail}=require('../mailer');
const r=express.Router();

// Multer setup
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

// Helper: cek apakah user punya akses ke task
function hasAccess(task,userId,d){
  if(task.assignee_id===userId)return true;
  // cek task_groups
  const grp=d.task_groups.find(g=>g.task_id===task.id);
  if(grp&&(grp.pic_id===userId||grp.members.includes(userId)))return true;
  return false;
}

// Helper: enrich task dengan info group
function enrichTask(task,d){
  const grp=d.task_groups.find(g=>g.task_id===task.id);
  const assigneeName=(d.users.find(u=>u.id===task.assignee_id)||{}).name||null;
  if(grp){
    const picName=(d.users.find(u=>u.id===grp.pic_id)||{}).name||'—';
    const memberNames=grp.members.map(mid=>(d.users.find(u=>u.id===mid)||{}).name||'?');
    return{...task,assignee_name:assigneeName,is_group:true,group_id:grp.id,group_name:grp.name,pic_id:grp.pic_id,pic_name:picName,member_ids:grp.members,member_names:memberNames};
  }
  return{...task,assignee_name:assigneeName,is_group:false};
}

// GET stats
r.get('/stats',requireLogin,(req,res)=>{
  const d=db.get(),today=new Date().toISOString().split('T')[0];
  const uid=req.session.user.id,role=req.session.user.role;
  let tasks;
  if(role==='manager'){tasks=d.tasks;}
  else{
    tasks=d.tasks.filter(t=>{
      if(t.assignee_id===uid)return true;
      const grp=d.task_groups.find(g=>g.task_id===t.id);
      return grp&&(grp.pic_id===uid||grp.members.includes(uid));
    });
  }
  res.json({
    total:tasks.length,
    done:tasks.filter(t=>t.status==='done').length,
    inprogress:tasks.filter(t=>t.status==='inprogress').length,
    overdue:tasks.filter(t=>t.deadline&&t.deadline<today&&t.status!=='done').length
  });
});

// GET semua tasks
r.get('/',requireLogin,(req,res)=>{
  const d=db.get();
  const uid=req.session.user.id,role=req.session.user.role;
  let tasks;
  if(role==='manager'){
    tasks=d.tasks;
  } else {
    tasks=d.tasks.filter(t=>{
      if(t.assignee_id===uid)return true;
      const grp=d.task_groups.find(g=>g.task_id===t.id);
      return grp&&(grp.pic_id===uid||grp.members.includes(uid));
    });
  }
  res.json([...tasks].reverse().map(t=>enrichTask(t,d)));
});

// POST buat tugas individu
r.post('/',requireRole('manager'),(req,res)=>{
  const{title,description,assignee_id,priority,deadline}=req.body;
  if(!title)return res.status(400).json({error:'Judul wajib diisi'});
  const d=db.get(),id=db.nextId('tasks');
  const task={id,title,description:description||'',assignee_id:parseInt(assignee_id)||null,
    created_by:req.session.user.id,priority:priority||'med',status:'todo',
    deadline:deadline||null,task_type:'individual',
    created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  d.tasks.push(task);
  const assignee=d.users.find(u=>u.id===parseInt(assignee_id));
  if(assignee){
    const nid=db.nextId('notifications');
    d.notifications.push({id:nid,user_id:assignee.id,message:`Tugas baru untukmu: "${title}"`,type:'info',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(assignee.email,`[FlowDesk] Tugas Baru: ${title}`,
      `<h3>Halo ${assignee.name},</h3><p>Tugas baru ditetapkan untukmu:</p>
      <p><b>Judul:</b> ${title}</p><p><b>Prioritas:</b> ${priority}</p>
      <p><b>Deadline:</b> ${deadline||'-'}</p>`);
  } else {db.save(d);}
  res.json(enrichTask(task,d));
});

// POST buat tugas group
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
  const grp={id:gid,task_id:tid,name:group_name||title,pic_id:parseInt(pic_id),members,created_at:new Date().toISOString()};
  d.task_groups.push(grp);
  db.save(d);

  // Notif ke semua anggota
  members.forEach(mid=>{
    const u=d.users.find(u=>u.id===mid);
    if(u){
      const nid=db.nextId('notifications');
      const isPic=mid===parseInt(pic_id);
      d.notifications.push({id:nid,user_id:mid,
        message:`Tugas group "${title}" — kamu sebagai ${isPic?'PIC':'Anggota'}`,
        type:'info',is_read:0,created_at:new Date().toISOString()});
      db.save(d);
      sendMail(u.email,`[FlowDesk] Tugas Group: ${title}`,
        `<h3>Halo ${u.name},</h3>
        <p>Kamu ditambahkan ke tugas group <b>"${title}"</b> sebagai <b>${isPic?'PIC (Penanggung Jawab)':'Anggota'}</b>.</p>
        <p><b>Prioritas:</b> ${priority}</p><p><b>Deadline:</b> ${deadline||'-'}</p>`);
    }
  });
  res.json(enrichTask(task,d));
});

// PATCH update status (hanya PIC atau assignee atau manager)
r.patch('/:id/status',requireLogin,upload.single('file'),(req,res)=>{
  const{status,note}=req.body;
  if(!['todo','inprogress','review','done'].includes(status))
    return res.status(400).json({error:'Status tidak valid'});
  const d=db.get(),idx=d.tasks.findIndex(t=>t.id===parseInt(req.params.id));
  if(idx===-1)return res.status(404).json({error:'Tidak ditemukan'});
  const task=d.tasks[idx],user=req.session.user;
  const grp=d.task_groups.find(g=>g.task_id===task.id);

  // Cek izin update status
  if(user.role!=='manager'){
    if(grp){
      if(grp.pic_id!==user.id)return res.status(403).json({error:'Hanya PIC yang bisa update status tugas group'});
    } else {
      if(task.assignee_id!==user.id)return res.status(403).json({error:'Bukan tugasmu'});
    }
  }

  // Simpan submission
  if(note||(req.file&&status!=='todo')){
    const sid=db.nextId('submissions');
    d.submissions.push({
      id:sid,task_id:parseInt(req.params.id),task_title:task.title,
      user_id:user.id,user_name:user.name,
      status_change:`${task.status} → ${status}`,
      note:note||'',
      file:req.file?`/uploads/${req.file.filename}`:null,
      file_name:req.file?req.file.originalname:null,
      created_at:new Date().toISOString()
    });
  }

  d.tasks[idx]={...task,status,updated_at:new Date().toISOString()};
  const sLabel={todo:'To Do',inprogress:'In Progress',review:'Review',done:'Selesai'};

  // Notif ke manager
  const manager=d.users.find(u=>u.role==='manager');
  if(manager&&manager.id!==user.id){
    const nid=db.nextId('notifications');
    d.notifications.push({id:nid,user_id:manager.id,
      message:`${user.name} update "${task.title}" → ${sLabel[status]}`,
      type:'success',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(manager.email,`[FlowDesk] Update: ${task.title}`,
      `<p><b>${user.name}</b> mengubah status <b>"${task.title}"</b> → <b>${sLabel[status]}</b></p>
      ${note?`<p><b>Catatan:</b> ${note}</p>`:''}`);
  } else {db.save(d);}

  // Notif ke anggota group lain
  if(grp){
    grp.members.filter(mid=>mid!==user.id&&mid!==manager?.id).forEach(mid=>{
      const nid=db.nextId('notifications');
      const dd=db.get();
      dd.notifications.push({id:nid,user_id:mid,
        message:`${user.name} update "${task.title}" → ${sLabel[status]}`,
        type:'info',is_read:0,created_at:new Date().toISOString()});
      db.save(dd);
    });
  }
  res.json({success:true});
});

// POST komentar
r.post('/:id/comment',requireLogin,(req,res)=>{
  const{comment}=req.body;
  if(!comment||!comment.trim())return res.status(400).json({error:'Komentar kosong'});
  const d=db.get();
  const task=d.tasks.find(t=>t.id===parseInt(req.params.id));
  if(!task)return res.status(404).json({error:'Tidak ditemukan'});
  if(d.session?.user?.role!=='manager'&&!hasAccess(task,req.session.user.id,d))
    return res.status(403).json({error:'Tidak punya akses'});
  const cid=db.nextId('task_comments');
  const c={id:cid,task_id:parseInt(req.params.id),user_id:req.session.user.id,
    user_name:req.session.user.name,comment:comment.trim(),created_at:new Date().toISOString()};
  d.task_comments.push(c);db.save(d);
  res.json(c);
});

// GET komentar
r.get('/:id/comments',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.task_comments.filter(c=>c.task_id===parseInt(req.params.id)));
});

// GET submissions per tugas
r.get('/:id/submissions',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.submissions.filter(s=>s.task_id===parseInt(req.params.id)));
});

// GET semua submissions (manager)
r.get('/all/submissions',requireRole('manager'),(req,res)=>{
  const d=db.get();
  res.json([...d.submissions].reverse());
});

r.delete('/:id',requireRole('manager'),(req,res)=>{
  const d=db.get();
  d.tasks=d.tasks.filter(t=>t.id!==parseInt(req.params.id));
  d.task_groups=d.task_groups.filter(g=>g.task_id!==parseInt(req.params.id));
  db.save(d);res.json({success:true});
});

module.exports=r;

const express=require('express'),bcrypt=require('bcryptjs'),{db}=require('../database'),{sendMail}=require('../mailer'),{requireLogin,requireRole}=require('../middleware/auth'),r=express.Router();

r.post('/login',(req,res)=>{
  const{username,password}=req.body;
  if(!username||!password) return res.status(400).json({error:'Username dan password wajib diisi'});
  const d=db.get(),user=d.users.find(u=>u.username===username);
  if(!user) return res.status(401).json({error:'Username tidak ditemukan'});
  if(!bcrypt.compareSync(password,user.password)) return res.status(401).json({error:'Password salah'});
  req.session.user={id:user.id,name:user.name,username:user.username,role:user.role,email:user.email};
  res.json({success:true,user:req.session.user});
});

r.post('/logout',(req,res)=>{req.session.destroy();res.json({success:true});});

r.get('/me',(req,res)=>{
  if(!req.session.user) return res.status(401).json({error:'Belum login'});
  res.json(req.session.user);
});

r.post('/register',(req,res)=>{
  const{name,username,email,password,role}=req.body;
  if(!name||!username||!email||!password||!role) return res.status(400).json({error:'Semua field wajib diisi'});
  if(password.length<6) return res.status(400).json({error:'Password minimal 6 karakter'});
  if(!['teamlead','karyawan'].includes(role)) return res.status(400).json({error:'Role tidak valid'});
  const d=db.get();
  if(d.users.find(u=>u.username===username)||d.pending.find(p=>p.username===username))
    return res.status(400).json({error:'Username sudah dipakai'});
  if(d.users.find(u=>u.email===email)||d.pending.find(p=>p.email===email))
    return res.status(400).json({error:'Email sudah dipakai'});
  const id=db.nextId('pending');
  d.pending.push({id,name,username,email,password:bcrypt.hashSync(password,10),role,created_at:new Date().toISOString()});
  db.save(d);
  const manager=d.users.find(u=>u.role==='manager');
  if(manager){
    const nid=db.nextId('notifications');
    d.notifications.push({id:nid,user_id:manager.id,message:`Permintaan registrasi baru dari ${name} (${role})`,type:'info',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(manager.email,'[FlowDesk] Permintaan Registrasi Baru',
      `<h3>Ada pendaftaran baru menunggu persetujuan:</h3>
      <p><b>Nama:</b> ${name}</p><p><b>Username:</b> ${username}</p>
      <p><b>Email:</b> ${email}</p><p><b>Role:</b> ${role}</p>`
    );
  }
  res.json({success:true,message:'Pendaftaran berhasil! Tunggu persetujuan Manager.'});
});

r.patch('/change-password',requireLogin,(req,res)=>{
  const{old_password,new_password}=req.body;
  if(!old_password||!new_password) return res.status(400).json({error:'Semua field wajib diisi'});
  if(new_password.length<6) return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get(),idx=d.users.findIndex(u=>u.id===req.session.user.id);
  if(!bcrypt.compareSync(old_password,d.users[idx].password)) return res.status(401).json({error:'Password lama salah'});
  d.users[idx].password=bcrypt.hashSync(new_password,10);
  db.save(d);res.json({success:true});
});

r.post('/pending/:id/approve',requireRole('manager'),(req,res)=>{
  const d=db.get(),pid=parseInt(req.params.id);
  const p=d.pending.find(x=>x.id===pid);
  if(!p) return res.status(404).json({error:'Tidak ditemukan'});
  const uid=db.nextId('users');
  d.users.push({id:uid,name:p.name,username:p.username,email:p.email,password:p.password,role:p.role,created_at:new Date().toISOString()});
  d.pending=d.pending.filter(x=>x.id!==pid);
  db.save(d);
  sendMail(p.email,'[FlowDesk] Akun Kamu Disetujui!',
    `<h3>Selamat ${p.name}!</h3><p>Akun FlowDesk kamu telah <b>disetujui</b> oleh Manager.</p>
    <p><b>Username:</b> ${p.username}</p><p>Silakan login sekarang.</p>`
  );
  res.json({success:true});
});

r.post('/pending/:id/reject',requireRole('manager'),(req,res)=>{
  const d=db.get(),pid=parseInt(req.params.id);
  const p=d.pending.find(x=>x.id===pid);
  if(!p) return res.status(404).json({error:'Tidak ditemukan'});
  d.pending=d.pending.filter(x=>x.id!==pid);
  db.save(d);
  sendMail(p.email,'[FlowDesk] Pendaftaran Ditolak',
    `<h3>Halo ${p.name},</h3><p>Maaf, pendaftaran kamu <b>ditolak</b> oleh Manager.</p>`
  );
  res.json({success:true});
});

r.get('/pending',requireRole('manager'),(req,res)=>{
  const{pending}=db.get();
  res.json(pending.map(p=>({id:p.id,name:p.name,username:p.username,email:p.email,role:p.role,created_at:p.created_at})));
});

module.exports=r;

// Ubah nama sendiri
const {requireLogin: _rl} = require('../middleware/auth');
r.patch('/update-profile', _rl, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama tidak boleh kosong' });
  if (name.trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });
  const d = require('../database').db.get();
  const idx = d.users.findIndex(u => u.id === req.session.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User tidak ditemukan' });
  d.users[idx].name = name.trim();
  require('../database').db.save(d);
  req.session.user.name = name.trim();
  res.json({ success: true, name: name.trim() });
});

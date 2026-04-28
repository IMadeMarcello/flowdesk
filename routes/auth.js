const express=require('express'),bcrypt=require('bcryptjs'),crypto=require('crypto');
const {db}=require('../database');
const {sendMail}=require('../mailer');
const {requireLogin,requireRole}=require('../middleware/auth');
const r=express.Router();

r.post('/login',(req,res)=>{
  const{username,password}=req.body;
  if(!username||!password)return res.status(400).json({error:'Username dan password wajib diisi'});
  const d=db.get();
  const user=d.users.find(u=>u.username===username);
  if(!user)return res.status(401).json({error:'Username tidak ditemukan'});
  if(!bcrypt.compareSync(password,user.password))return res.status(401).json({error:'Password salah'});
  req.session.user={id:user.id,name:user.name,username:user.username,role:user.role,email:user.email};
  res.json({success:true,user:req.session.user});
});

r.post('/logout',(req,res)=>{
  req.session.destroy();
  res.json({success:true});
});

r.get('/me',(req,res)=>{
  if(!req.session.user)return res.status(401).json({error:'Belum login'});
  res.json(req.session.user);
});

r.post('/register',(req,res)=>{
  const{name,username,email,password,role}=req.body;
  if(!name||!username||!email||!password||!role)return res.status(400).json({error:'Semua field wajib diisi'});
  if(password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  if(!['teamlead','karyawan'].includes(role))return res.status(400).json({error:'Role tidak valid'});
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
    d.notifications.push({id:nid,user_id:manager.id,message:`Permintaan daftar dari ${name} (${role})`,type:'info',is_read:0,created_at:new Date().toISOString()});
    db.save(d);
    sendMail(manager.email,'[FlowDesk] Permintaan Registrasi Baru',`<p>Ada pendaftaran baru dari <b>${name}</b> sebagai <b>${role}</b>.</p>`);
  }
  res.json({success:true,message:'Pendaftaran berhasil! Tunggu persetujuan Manager.'});
});

r.patch('/change-password',requireLogin,(req,res)=>{
  const{old_password,new_password}=req.body;
  if(!old_password||!new_password)return res.status(400).json({error:'Semua field wajib diisi'});
  if(new_password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get();
  const idx=d.users.findIndex(u=>u.id===req.session.user.id);
  if(!bcrypt.compareSync(old_password,d.users[idx].password))return res.status(401).json({error:'Password lama salah'});
  d.users[idx].password=bcrypt.hashSync(new_password,10);
  db.save(d);
  res.json({success:true});
});

r.patch('/update-profile',requireLogin,(req,res)=>{
  const{name}=req.body;
  if(!name||!name.trim())return res.status(400).json({error:'Nama tidak boleh kosong'});
  const d=db.get();
  const idx=d.users.findIndex(u=>u.id===req.session.user.id);
  if(idx===-1)return res.status(404).json({error:'User tidak ditemukan'});
  d.users[idx].name=name.trim();
  db.save(d);
  req.session.user.name=name.trim();
  res.json({success:true,name:name.trim()});
});

// FORGOT PASSWORD - kirim link reset
r.post('/forgot-password',(req,res)=>{
  const{email}=req.body;
  if(!email)return res.status(400).json({error:'Email wajib diisi'});
  const d=db.get();
  const user=d.users.find(u=>u.email===email.trim().toLowerCase());
  // Selalu jawab sukses agar tidak bocorkan info email terdaftar
  if(!user){
    return res.json({success:true,message:'Jika email terdaftar, link reset akan dikirim.'});
  }
  // Buat token
  const token=crypto.randomBytes(32).toString('hex');
  const expires=Date.now()+(60*60*1000); // 1 jam
  if(!d.reset_tokens)d.reset_tokens=[];
  // Hapus token lama untuk user ini
  d.reset_tokens=d.reset_tokens.filter(t=>t.user_id!==user.id);
  d.reset_tokens.push({user_id:user.id,token,expires});
  db.save(d);
  // Kirim email
  const BASE_URL=process.env.BASE_URL||`http://localhost:${process.env.PORT||3000}`;
  const resetLink=`${BASE_URL}/reset-password?token=${token}`;
  sendMail(user.email,'[FlowDesk] Reset Password',
    `<div style="font-family:sans-serif;max-width:500px;margin:0 auto">
      <h2 style="color:#10b981">Reset Password FlowDesk</h2>
      <p>Halo <b>${user.name}</b>,</p>
      <p>Kami menerima permintaan reset password untuk akun kamu.</p>
      <p>Klik tombol di bawah untuk reset password:</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${resetLink}" style="background:#10b981;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Reset Password</a>
      </div>
      <p style="color:#888;font-size:12px">Link ini berlaku selama <b>1 jam</b>. Abaikan email ini jika kamu tidak meminta reset password.</p>
      <p style="color:#888;font-size:12px">Atau copy link berikut:<br><a href="${resetLink}">${resetLink}</a></p>
    </div>`
  );
  res.json({success:true,message:'Jika email terdaftar, link reset akan dikirim.'});
});

// Validasi token reset
r.get('/reset-password',(req,res)=>{
  const{token}=req.query;
  if(!token)return res.status(400).json({error:'Token tidak valid'});
  const d=db.get();
  if(!d.reset_tokens)return res.status(400).json({error:'Token tidak valid atau sudah expired'});
  const tokenData=d.reset_tokens.find(t=>t.token===token);
  if(!tokenData)return res.status(400).json({error:'Token tidak valid atau sudah expired'});
  if(Date.now()>tokenData.expires)return res.status(400).json({error:'Token sudah expired. Silakan minta reset password baru.'});
  res.json({success:true,valid:true});
});

// Submit password baru
r.post('/reset-password',(req,res)=>{
  const{token,new_password}=req.body;
  if(!token||!new_password)return res.status(400).json({error:'Data tidak lengkap'});
  if(new_password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get();
  if(!d.reset_tokens)return res.status(400).json({error:'Token tidak valid'});
  const tokenData=d.reset_tokens.find(t=>t.token===token);
  if(!tokenData)return res.status(400).json({error:'Token tidak valid atau sudah expired'});
  if(Date.now()>tokenData.expires)return res.status(400).json({error:'Token sudah expired. Silakan minta reset password baru.'});
  const idx=d.users.findIndex(u=>u.id===tokenData.user_id);
  if(idx===-1)return res.status(404).json({error:'User tidak ditemukan'});
  d.users[idx].password=bcrypt.hashSync(new_password,10);
  // Hapus token setelah dipakai
  d.reset_tokens=d.reset_tokens.filter(t=>t.token!==token);
  db.save(d);
  res.json({success:true,message:'Password berhasil direset! Silakan login.'});
});

r.post('/pending/:id/approve',requireRole('manager'),(req,res)=>{
  const d=db.get(),pid=parseInt(req.params.id);
  const p=d.pending.find(x=>x.id===pid);
  if(!p)return res.status(404).json({error:'Tidak ditemukan'});
  const uid=db.nextId('users');
  d.users.push({id:uid,name:p.name,username:p.username,email:p.email,password:p.password,role:p.role,created_at:new Date().toISOString()});
  d.pending=d.pending.filter(x=>x.id!==pid);
  db.save(d);
  sendMail(p.email,'[FlowDesk] Akun Disetujui',`<p>Halo ${p.name}, akun kamu telah disetujui. Username: ${p.username}</p>`);
  res.json({success:true});
});

r.post('/pending/:id/reject',requireRole('manager'),(req,res)=>{
  const d=db.get(),pid=parseInt(req.params.id);
  const p=d.pending.find(x=>x.id===pid);
  if(!p)return res.status(404).json({error:'Tidak ditemukan'});
  d.pending=d.pending.filter(x=>x.id!==pid);
  db.save(d);
  sendMail(p.email,'[FlowDesk] Pendaftaran Ditolak',`<p>Halo ${p.name}, pendaftaran kamu ditolak.</p>`);
  res.json({success:true});
});

r.get('/pending',requireRole('manager'),(req,res)=>{
  const{pending}=db.get();
  res.json(pending.map(p=>({id:p.id,name:p.name,username:p.username,email:p.email,role:p.role,created_at:p.created_at})));
});

module.exports=r;

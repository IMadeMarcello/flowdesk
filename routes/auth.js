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

r.post('/logout',(req,res)=>{req.session.destroy();res.json({success:true});});

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

// KIRIM OTP
r.post('/forgot-password',(req,res)=>{
  const{email}=req.body;
  if(!email)return res.status(400).json({error:'Email wajib diisi'});
  const d=db.get();
  const user=d.users.find(u=>u.email===email.trim().toLowerCase());
  if(!user)return res.json({success:true,message:'Jika email terdaftar, kode OTP akan dikirim.'});
  // Buat OTP 6 digit
  const otp=Math.floor(100000+Math.random()*900000).toString();
  const expires=Date.now()+(10*60*1000); // 10 menit
  if(!d.reset_tokens)d.reset_tokens=[];
  // Hapus OTP lama
  d.reset_tokens=d.reset_tokens.filter(t=>t.user_id!==user.id);
  d.reset_tokens.push({user_id:user.id,otp,expires,email:user.email});
  db.save(d);
  // Kirim email OTP
  sendMail(user.email,'[FlowDesk] Kode OTP Reset Password',`
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <h2 style="color:#5b8ff9;font-size:24px;margin:0">🗂 FlowDesk</h2>
        <p style="color:#888;margin-top:4px">Reset Password</p>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:24px;text-align:center">
        <p style="color:#333;margin-bottom:16px">Halo <b>${user.name}</b>, berikut kode OTP untuk reset password kamu:</p>
        <div style="background:white;border:2px dashed #5b8ff9;border-radius:12px;padding:24px;margin:16px 0">
          <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#5b8ff9;font-family:monospace">${otp}</div>
        </div>
        <p style="color:#888;font-size:13px">Kode ini berlaku selama <b>10 menit</b></p>
        <p style="color:#ef4444;font-size:12px;margin-top:8px">Jangan berikan kode ini kepada siapapun!</p>
      </div>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:16px">Jika kamu tidak meminta reset password, abaikan email ini.</p>
    </div>
  `);
  res.json({success:true,message:'Kode OTP telah dikirim ke email kamu.'});
});

// VERIFIKASI OTP
r.post('/verify-otp',(req,res)=>{
  const{email,otp}=req.body;
  if(!email||!otp)return res.status(400).json({error:'Email dan OTP wajib diisi'});
  const d=db.get();
  if(!d.reset_tokens)return res.status(400).json({error:'OTP tidak valid'});
  const tokenData=d.reset_tokens.find(t=>t.email===email.trim().toLowerCase()&&t.otp===otp.trim());
  if(!tokenData)return res.status(400).json({error:'Kode OTP salah'});
  if(Date.now()>tokenData.expires)return res.status(400).json({error:'Kode OTP sudah kadaluarsa. Minta kode baru.'});
  // Buat session token untuk submit password baru
  const session_token=crypto.randomBytes(16).toString('hex');
  tokenData.session_token=session_token;
  tokenData.otp_verified=true;
  db.save(d);
  res.json({success:true,session_token});
});

// RESET PASSWORD DENGAN SESSION TOKEN
r.post('/reset-password',(req,res)=>{
  const{session_token,new_password}=req.body;
  if(!session_token||!new_password)return res.status(400).json({error:'Data tidak lengkap'});
  if(new_password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get();
  if(!d.reset_tokens)return res.status(400).json({error:'Sesi tidak valid'});
  const tokenData=d.reset_tokens.find(t=>t.session_token===session_token&&t.otp_verified);
  if(!tokenData)return res.status(400).json({error:'Sesi tidak valid atau sudah kadaluarsa'});
  if(Date.now()>tokenData.expires)return res.status(400).json({error:'Sesi kadaluarsa. Silakan mulai ulang.'});
  const idx=d.users.findIndex(u=>u.id===tokenData.user_id);
  if(idx===-1)return res.status(404).json({error:'User tidak ditemukan'});
  d.users[idx].password=bcrypt.hashSync(new_password,10);
  d.reset_tokens=d.reset_tokens.filter(t=>t.session_token!==session_token);
  db.save(d);
  res.json({success:true,message:'Password berhasil direset!'});
});

r.post('/pending/:id/approve',requireRole('manager'),(req,res)=>{
  const d=db.get(),pid=parseInt(req.params.id);
  const p=d.pending.find(x=>x.id===pid);
  if(!p)return res.status(404).json({error:'Tidak ditemukan'});
  const uid=db.nextId('users');
  d.users.push({id:uid,name:p.name,username:p.username,email:p.email,password:p.password,role:p.role,created_at:new Date().toISOString()});
  d.pending=d.pending.filter(x=>x.id!==pid);
  db.save(d);
  sendMail(p.email,'[FlowDesk] Akun Disetujui',`<p>Halo ${p.name}, akun kamu telah disetujui! Username: <b>${p.username}</b></p>`);
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

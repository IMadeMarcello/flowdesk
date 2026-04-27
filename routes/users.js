const express=require('express'),bcrypt=require('bcryptjs');
const {db}=require('../database');
const {requireLogin,requireRole}=require('../middleware/auth');
const {sendMail}=require('../mailer');
const r=express.Router();

r.get('/',requireLogin,(req,res)=>{
  const{users}=db.get();
  res.json(users.map(u=>({id:u.id,name:u.name,username:u.username,email:u.email,role:u.role,created_at:u.created_at})));
});

r.post('/',requireRole('manager'),(req,res)=>{
  const{name,username,email,password,role}=req.body;
  if(!name||!username||!email||!password||!role)return res.status(400).json({error:'Semua field wajib diisi'});
  if(password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get();
  if(d.users.find(u=>u.username===username))return res.status(400).json({error:'Username sudah dipakai'});
  if(d.users.find(u=>u.email===email))return res.status(400).json({error:'Email sudah dipakai'});
  const id=db.nextId('users');
  d.users.push({id,name,username,email,password:bcrypt.hashSync(password,10),role,created_at:new Date().toISOString()});
  db.save(d);
  sendMail(email,'[FlowDesk] Akun Dibuat',`<p>Halo ${name}, akun kamu dibuat. Username: ${username}, Password: ${password}</p>`);
  res.json({id,name,username,email,role});
});

r.delete('/:id',requireRole('manager'),(req,res)=>{
  const d=db.get();
  const id=parseInt(req.params.id);
  if(id===req.session.user.id)return res.status(400).json({error:'Tidak bisa hapus akun sendiri'});
  d.users=d.users.filter(u=>u.id!==id);
  d.tasks=d.tasks.map(t=>({...t,assignee_id:t.assignee_id===id?null:t.assignee_id}));
  db.save(d);res.json({success:true});
});

r.patch('/:id/reset-password',requireRole('manager'),(req,res)=>{
  const{new_password}=req.body;
  if(!new_password||new_password.length<6)return res.status(400).json({error:'Password minimal 6 karakter'});
  const d=db.get();
  const idx=d.users.findIndex(u=>u.id===parseInt(req.params.id));
  if(idx===-1)return res.status(404).json({error:'User tidak ditemukan'});
  d.users[idx].password=bcrypt.hashSync(new_password,10);
  db.save(d);
  sendMail(d.users[idx].email,'[FlowDesk] Password Direset',`<p>Password kamu direset. Password baru: ${new_password}</p>`);
  res.json({success:true});
});

r.get('/notifications',requireLogin,(req,res)=>{
  const{notifications}=db.get();
  res.json(notifications.filter(n=>n.user_id===req.session.user.id).reverse().slice(0,30));
});

r.patch('/notifications/read',requireLogin,(req,res)=>{
  const d=db.get();
  d.notifications=d.notifications.map(n=>n.user_id===req.session.user.id?{...n,is_read:1}:n);
  db.save(d);res.json({success:true});
});

r.get('/activity',requireRole('manager'),(req,res)=>{
  const{notifications}=db.get();
  res.json([...notifications].reverse().slice(0,50));
});

module.exports=r;

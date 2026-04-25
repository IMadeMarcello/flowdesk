const express=require('express'),{db}=require('../database'),{requireLogin}=require('../middleware/auth'),r=express.Router();

r.post('/',requireLogin,(req,res)=>{
  const{message,to_user_id}=req.body;
  if(!message||!message.trim())return res.status(400).json({error:'Pesan kosong'});
  const d=db.get();
  if(!d.chats)d.chats=[];
  if(!d._seq.chats)d._seq.chats=0;
  const id=db.nextId('chats');
  const chat={id,from_id:req.session.user.id,from_name:req.session.user.name,
    from_role:req.session.user.role,to_user_id:to_user_id?parseInt(to_user_id):null,
    message:message.trim(),created_at:new Date().toISOString()};
  d.chats.push(chat);db.save(d);
  res.json(chat);
});

r.get('/group',requireLogin,(req,res)=>{
  const d=db.get();if(!d.chats)return res.json([]);
  res.json(d.chats.filter(c=>c.to_user_id===null).slice(-100));
});

r.get('/personal/:userId',requireLogin,(req,res)=>{
  const d=db.get();if(!d.chats)return res.json([]);
  const me=req.session.user.id,other=parseInt(req.params.userId);
  res.json(d.chats.filter(c=>c.to_user_id!==null&&
    ((c.from_id===me&&c.to_user_id===other)||(c.from_id===other&&c.to_user_id===me))
  ).slice(-100));
});

// Tampilkan SEMUA user (bukan hanya yang sudah pernah chat)
r.get('/users',requireLogin,(req,res)=>{
  const d=db.get();
  const users=d.users
    .filter(u=>u.id!==req.session.user.id)
    .map(u=>({id:u.id,name:u.name,role:u.role,username:u.username}));
  res.json(users);
});

r.get('/contacts',requireLogin,(req,res)=>{
  const d=db.get();if(!d.chats)return res.json([]);
  const me=req.session.user.id;
  const ids=new Set();
  d.chats.filter(c=>c.to_user_id!==null).forEach(c=>{
    if(c.from_id===me)ids.add(c.to_user_id);
    if(c.to_user_id===me)ids.add(c.from_id);
  });
  res.json(d.users.filter(u=>u.id!==me&&ids.has(u.id)).map(u=>({id:u.id,name:u.name,role:u.role})));
});

module.exports=r;

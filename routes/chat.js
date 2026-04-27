const express=require('express');
const {db}=require('../database');
const {requireLogin}=require('../middleware/auth');
const r=express.Router();

r.post('/',requireLogin,(req,res)=>{
  const{message,to_user_id}=req.body;
  if(!message||!message.trim())return res.status(400).json({error:'Pesan kosong'});
  const d=db.get();
  const id=db.nextId('chats');
  const chat={id,from_id:req.session.user.id,from_name:req.session.user.name,
    from_role:req.session.user.role,to_user_id:to_user_id?parseInt(to_user_id):null,
    message:message.trim(),is_read_by:[req.session.user.id],created_at:new Date().toISOString()};
  d.chats.push(chat);db.save(d);
  res.json(chat);
});

r.get('/group',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.chats.filter(c=>c.to_user_id===null).slice(-100));
});

r.get('/personal/:userId',requireLogin,(req,res)=>{
  const d=db.get();
  const me=req.session.user.id,other=parseInt(req.params.userId);
  res.json(d.chats.filter(c=>c.to_user_id!==null&&
    ((c.from_id===me&&c.to_user_id===other)||(c.from_id===other&&c.to_user_id===me))
  ).slice(-100));
});

r.patch('/read/:userId',requireLogin,(req,res)=>{
  const d=db.get();
  const me=req.session.user.id,other=parseInt(req.params.userId);
  d.chats=d.chats.map(c=>{
    if(c.to_user_id!==null&&c.from_id===other&&c.to_user_id===me){
      if(!c.is_read_by)c.is_read_by=[other];
      if(!c.is_read_by.includes(me))c.is_read_by.push(me);
    }
    return c;
  });
  db.save(d);res.json({success:true});
});

r.patch('/read-group',requireLogin,(req,res)=>{
  const d=db.get();
  const me=req.session.user.id;
  d.chats=d.chats.map(c=>{
    if(c.to_user_id===null){
      if(!c.is_read_by)c.is_read_by=[c.from_id];
      if(!c.is_read_by.includes(me))c.is_read_by.push(me);
    }
    return c;
  });
  db.save(d);res.json({success:true});
});

r.get('/unread',requireLogin,(req,res)=>{
  const d=db.get();
  const me=req.session.user.id;
  const personal={};let group=0;
  d.chats.forEach(c=>{
    if(!c.is_read_by)c.is_read_by=[c.from_id];
    if(c.from_id===me)return;
    if(c.to_user_id===null){if(!c.is_read_by.includes(me))group++;}
    else if(c.to_user_id===me){if(!c.is_read_by.includes(me))personal[c.from_id]=(personal[c.from_id]||0)+1;}
  });
  res.json({total:group+Object.values(personal).reduce((a,b)=>a+b,0),personal,group});
});

r.get('/users',requireLogin,(req,res)=>{
  const d=db.get();
  res.json(d.users.filter(u=>u.id!==req.session.user.id).map(u=>({id:u.id,name:u.name,role:u.role,username:u.username})));
});

module.exports=r;

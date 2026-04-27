const express=require('express');
const session=require('express-session');
const path=require('path');
const {init}=require('./database');

const app=express();
const PORT=process.env.PORT||3000;

init();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));
app.use(session({
  secret:process.env.SESSION_SECRET||'flowdesk-secret-2025',
  resave:false,
  saveUninitialized:false,
  cookie:{maxAge:86400000}
}));

app.use('/api/auth',require('./routes/auth'));
app.use('/api/tasks',require('./routes/tasks'));
app.use('/api/users',require('./routes/users'));
app.use('/api/chat',require('./routes/chat'));
app.use('/api',require('./routes/users'));

app.get('/{*path}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`✅ FlowDesk jalan di port ${PORT}`);
  console.log(`👤 Login: manager / manager123`);
});

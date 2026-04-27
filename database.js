const fs=require('fs'),path=require('path'),bcrypt=require('bcryptjs');
const F=path.join(__dirname,'db.json');
const load=()=>{
  if(!fs.existsSync(F))return{users:[],tasks:[],notifications:[],pending:[],chats:[],submissions:[],task_groups:[],task_comments:[],_seq:{users:0,tasks:0,notifications:0,pending:0,chats:0,submissions:0,task_groups:0,task_comments:0}};
  const d=JSON.parse(fs.readFileSync(F,'utf8'));
  if(!d.chats)d.chats=[];
  if(!d.pending)d.pending=[];
  if(!d.submissions)d.submissions=[];
  if(!d.task_groups)d.task_groups=[];
  if(!d.task_comments)d.task_comments=[];
  if(!d._seq)d._seq={};
  ['chats','pending','submissions','task_groups','task_comments','users','tasks','notifications'].forEach(k=>{if(!d._seq[k])d._seq[k]=0;});
  return d;
};
const save=d=>fs.writeFileSync(F,JSON.stringify(d,null,2));
const nextId=col=>{const d=load();d._seq[col]=(d._seq[col]||0)+1;save(d);return d._seq[col];};
function init(){
  const d=load();
  if(d.users.length===0){
    d.users=[{id:1,name:'Manager',username:'manager',email:'manager@email.com',password:bcrypt.hashSync('manager123',10),role:'manager',created_at:new Date().toISOString()}];
    d.tasks=[];d.notifications=[];d.chats=[];d.pending=[];d.submissions=[];d.task_groups=[];d.task_comments=[];
    d._seq={users:1,tasks:0,notifications:0,pending:0,chats:0,submissions:0,task_groups:0,task_comments:0};
    save(d);
    console.log('✅ DB init — login: manager / manager123');
  }else{save(d);}
}
module.exports={db:{get:load,save,nextId},init};

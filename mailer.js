const nodemailer=require('nodemailer');

function getTransporter(){
  const user=process.env.EMAIL_USER;
  const pass=process.env.EMAIL_PASS;
  if(user&&pass){
    return nodemailer.createTransport({service:'gmail',auth:{user,pass}});
  }
  try{
    const config=require('./config');
    if(config.email&&config.email.user&&config.email.pass){
      return nodemailer.createTransport({service:'gmail',auth:{user:config.email.user,pass:config.email.pass}});
    }
  }catch(e){}
  return null;
}

async function sendMail(to,subject,html){
  const transporter=getTransporter();
  if(!transporter){
    console.log('[Email skip] To:'+to+' | '+subject);
    return;
  }
  try{
    let from='FlowDesk <noreply@gmail.com>';
    try{from=process.env.EMAIL_FROM||require('./config').email.from;}catch(e){}
    await transporter.sendMail({from,to,subject,html});
    console.log('Email terkirim ke '+to);
  }catch(e){
    console.error('Email gagal:'+e.message);
  }
}

module.exports={sendMail};

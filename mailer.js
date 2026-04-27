const nodemailer=require('nodemailer');
let transporter=null;
try{
  const config=require('./config');
  transporter=nodemailer.createTransport({service:'gmail',auth:{user:config.email.user,pass:config.email.pass}});
}catch(e){console.log('Email config tidak ada, skip email');}
async function sendMail(to,subject,html){
  if(!transporter){console.log(`[Email skip] To:${to} | ${subject}`);return;}
  try{
    const config=require('./config');
    await transporter.sendMail({from:config.email.from,to,subject,html});
    console.log(`📧 Email ke ${to}`);
  }catch(e){console.error('Email gagal:',e.message);}
}
module.exports={sendMail};

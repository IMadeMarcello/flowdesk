const nodemailer=require('nodemailer');

const transporter=nodemailer.createTransport({
  service:'gmail',
  auth:{
    user:process.env.EMAIL_USER||'',
    pass:process.env.EMAIL_PASS||''
  }
});

async function sendMail(to,subject,html){
  if(!process.env.EMAIL_USER){
    console.log(`📧 [Skip email] To:${to} Subject:${subject}`);
    return;
  }
  try{
    await transporter.sendMail({
      from:process.env.EMAIL_FROM||process.env.EMAIL_USER,
      to,subject,html
    });
    console.log(`📧 Email terkirim ke ${to}`);
  }catch(e){
    console.error(`❌ Gagal kirim email:`,e.message);
  }
}

module.exports={sendMail};

const nodemailer = require('nodemailer');

// Configuração ISOLADA (Sem banco de dados, sem express)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, 
    auth: {
        user: 'rdbarbercontato@gmail.com',
        pass: 'dvam kape djwk jniv' // Sua senha atual
    },
    tls: {
        rejectUnauthorized: false
    }
});

const mailOptions = {
    from: 'barbeariadorod.contato@gmail.com',
    to: 'barbeariadorod.contato@gmail.com', // Envia para você mesmo
    subject: 'Teste de Diagnóstico - Barbearia',
    text: 'Se você está lendo isso, a SENHA ESTÁ CORRETA e o problema é outro!'
};

console.log("⏳ Tentando conectar ao Gmail...");

transporter.sendMail(mailOptions, function(error, info){
    if (error) {
        console.log("❌ DEU ERRO (O problema é a senha/conta):");
        console.log(error);
    } else {
        console.log("✅ SUCESSO! (O problema era cache/código antigo):");
        console.log('E-mail enviado: ' + info.response);
    }
});
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

const app = express();

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5500";

app.use(helmet());

app.use(cors({ 
    origin: FRONTEND_URL, 
    optionsSuccessStatus: 200 
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Muitas requisições criadas a partir deste IP, tente novamente mais tarde."
});
app.use(limiter);

app.use(express.json());

if (!process.env.MP_ACCESS_TOKEN || !process.env.MONGO_URI) {
    console.error("Erro: Variáveis de ambiente não configuradas.");
    process.exit(1);
}

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);
const preference = new Preference(client);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Banco de Dados Conectado!'))
  .catch(err => console.error('❌ Erro no Banco:', err));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }, 
    tls: { rejectUnauthorized: false }
});

const Agendamento = mongoose.model('Agendamento', {
  nome: String, 
  email: String, 
  data: String, 
  hora: String,
  servico: String, 
  valor: Number, 
  pagamentoId: String, 
  statusPagamento: String,
  pixCopiaCola: String,
  qrCodeBase64: String,
  urlPagamentoCartao: String
});

const Usuario = mongoose.model('Usuario', {
  nome: String, email: { type: String, unique: true }, senha: String,
  resetPasswordToken: String, resetPasswordExpires: Date
});

function gerarEmailBonito(titulo, subtitulo, detalhes, corDestaque = '#e62e2e') {
    return `<div style="background-color: #121212; padding: 40px 20px; font-family: sans-serif;"><div style="max-width: 600px; margin: 0 auto; background-color: #1e1e1e; border-radius: 12px; border: 1px solid #333;"><div style="background-color: ${corDestaque}; padding: 20px; text-align: center;"><h1 style="color: #fff; margin: 0; font-size: 24px;">${titulo}</h1></div><div style="padding: 30px;"><p style="color: #ccc; text-align: center;">${subtitulo}</p><div style="background-color: #252525; border-radius: 8px; padding: 20px; margin-top: 20px;"><table style="width: 100%; color: #ddd;">${detalhes}</table></div><div style="text-align: center; margin-top: 30px;"><a href="${FRONTEND_URL}/meus-agendamentos.html" style="background-color: ${corDestaque}; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">VER NO SITE</a></div></div></div></div>`;
}

app.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    const senhaCripto = await bcrypt.hash(senha, 10);
    const novoUsuario = new Usuario({ nome, email, senha: senhaCripto });
    await novoUsuario.save();
    res.json({ mensagem: 'Usuário cadastrado!' });
  } catch (error) { res.status(500).json({ erro: 'E-mail já cadastrado.' }); }
});

app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(400).json({ erro: 'E-mail não encontrado' });
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) return res.status(400).json({ erro: 'Senha incorreta' });
    res.json({ mensagem: 'Login OK', usuario: { nome: usuario.nome, email: usuario.email } });
  } catch (error) { res.status(500).json({ erro: 'Erro no login' }); }
});

app.post('/esqueci-senha', async (req, res) => {
    const { email } = req.body;
    try {
        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ erro: 'E-mail não encontrado.' });
        const token = crypto.randomBytes(20).toString('hex');
        const agora = new Date(); agora.setHours(agora.getHours() + 1);
        usuario.resetPasswordToken = token; usuario.resetPasswordExpires = agora;
        await usuario.save();
        const linkReset = `${FRONTEND_URL}/resetar-senha.html?token=${token}`;
        transporter.sendMail({
            from: `RodBarber <${process.env.EMAIL_USER}>`, to: email, subject: 'Recuperar Senha',
            html: `<p>Clique: <a href="${linkReset}">REDEFINIR</a></p>`
        }).catch(console.error);
        res.json({ mensagem: 'E-mail enviado!' });
    } catch (err) { res.status(500).json({ erro: 'Erro.' }); }
});

app.post('/resetar-senha', async (req, res) => {
    const { token, novaSenha } = req.body;
    try {
        const usuario = await Usuario.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!usuario) return res.status(400).json({ erro: 'Token inválido.' });
        usuario.senha = await bcrypt.hash(novaSenha, 10);
        usuario.resetPasswordToken = undefined; usuario.resetPasswordExpires = undefined;
        await usuario.save();
        res.json({ mensagem: 'Senha alterada!' });
    } catch (err) { res.status(500).json({ erro: 'Erro.' }); }
});

app.get('/agendamentos/ocupados', async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ mensagem: "Data obrigatória" });
    try {
        const agendamentos = await Agendamento.find({ data: data });
        res.json(agendamentos.map(ag => ag.hora));
    } catch (error) { res.status(500).json({ mensagem: "Erro ao buscar." }); }
});

app.post('/agendar', async (req, res) => {
    try {
        const { nome, email, data, hora, servico, preco } = req.body;
        
        if (!nome || !email || !data || !hora || !servico || !preco) {
            return res.status(400).json({ mensagem: "Faltam dados." });
        }

        const conflito = await Agendamento.findOne({ data, hora });
        if (conflito) return res.status(400).json({ mensagem: "Horário já reservado!" });

        const paymentData = {
            transaction_amount: parseFloat(preco),
            description: `Corte ${servico} - ${data} ${hora}`,
            payment_method_id: 'pix',
            payer: { email: email, first_name: nome }
        };
        const pixResult = await payment.create({ body: paymentData });
        const codigoPix = pixResult.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = pixResult.point_of_interaction.transaction_data.qr_code_base64;
        const idPagamento = pixResult.id;

        const preferenceData = {
            body: {
                items: [
                    {
                        title: `Corte ${servico} - ${data} ${hora}`,
                        quantity: 1,
                        unit_price: parseFloat(preco),
                        currency_id: 'BRL'
                    }
                ],
                payer: { email: email, name: nome },
                back_urls: {
                    success: `${FRONTEND_URL}/meus-agendamentos.html`,
                    failure: `${FRONTEND_URL}/`,
                    pending: `${FRONTEND_URL}/`
                }
            }
        };
        
        const prefResult = await preference.create(preferenceData);
        const linkCartao = prefResult.init_point; 

        const novoAgendamento = new Agendamento({ 
            nome, email, data, hora, servico, valor: preco,
            pagamentoId: idPagamento.toString(),
            statusPagamento: 'pendente',
            pixCopiaCola: codigoPix,
            qrCodeBase64: qrCodeBase64,
            urlPagamentoCartao: linkCartao 
        });
        await novoAgendamento.save();

        res.status(201).json({ 
            mensagem: "Criado!", pixCopiaCola: codigoPix, qrCodeBase64: qrCodeBase64, 
            idPagamento: idPagamento, urlPagamentoCartao: linkCartao 
        });

        const linhasTabela = `
            <tr><td style="padding:8px;color:#888;">Cliente:</td><td style="padding:8px;color:#fff;">${nome}</td></tr>
            <tr><td style="padding:8px;color:#888;">Data:</td><td style="padding:8px;color:#fff;">${data} às ${hora}</td></tr>
            <tr><td style="padding:8px;color:#888;">Serviço:</td><td style="padding:8px;color:#fff;">${servico}</td></tr>
            <tr><td style="padding:8px;color:#888;">Valor:</td><td style="padding:8px;color:#25d366;">R$ ${preco},00</td></tr>
        `;
        const htmlBarbeiro = gerarEmailBonito("✂️ Novo Agendamento", "Novo cliente na área!", linhasTabela + `<tr><td>Status:</td><td style="color:orange">Aguardando Pagamento</td></tr>`);
        const htmlCliente = gerarEmailBonito("📅 Agendamento Recebido", "Recebemos seu pedido. Pague para confirmar.", linhasTabela);

        transporter.sendMail({ from: `RodBarber <${process.env.EMAIL_USER}>`, to: process.env.EMAIL_USER, subject: `🔔 NOVO: ${nome}`, html: htmlBarbeiro }).catch(console.error);
        transporter.sendMail({ from: `RodBarber <${process.env.EMAIL_USER}>`, to: email, subject: 'Agendamento Recebido', html: htmlCliente }).catch(console.error);

    } catch (err) { 
        console.error("ERRO NO AGENDAMENTO:", err);
        if(!res.headersSent) res.status(500).json({ mensagem: "Erro no servidor ao criar pagamento." }); 
    }
});

app.get('/status-pagamento/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const response = await payment.get({ id: id });
        const status = response.status; 
        if(status === 'approved') {
            const agendamento = await Agendamento.findOne({ pagamentoId: id });
            if (agendamento && agendamento.statusPagamento !== 'approved') {
                await Agendamento.findOneAndUpdate({ pagamentoId: id }, { statusPagamento: 'approved' });
                
                const htmlSucesso = gerarEmailBonito("✅ Pagamento Confirmado", "Seu horário está garantido!", `<tr><td style="color:#fff">${agendamento.data} às ${agendamento.hora}</td></tr>`, "#25d366");
                transporter.sendMail({ from: `RodBarber <${process.env.EMAIL_USER}>`, to: agendamento.email, subject: 'Confirmado ✅', html: htmlSucesso }).catch(console.error);
            }
        }
        res.json({ status: status });
    } catch (error) { res.status(500).json({ status: 'error' }); }
});

app.get('/agendamentos', async (req, res) => {
  try { const lista = await Agendamento.find(); res.json(lista); } catch (e) { res.status(500).json({ erro: 'Erro' }); }
});

app.get('/meus-agendamentos', async (req, res) => {
  try { const { email } = req.query; const lista = await Agendamento.find({ email }); res.json(lista); } catch (e) { res.status(500).json({ erro: 'Erro' }); }
});

app.delete('/agendamentos/:id', async (req, res) => {
  try { await Agendamento.findByIdAndDelete(req.params.id); res.json({ mensagem: 'Ok' }); } catch (e) { res.status(500).json({ erro: 'Erro' }); }
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
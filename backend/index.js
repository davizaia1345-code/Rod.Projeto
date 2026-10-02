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
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://127.0.0.1:5500").replace(/\/$/, '');

const allowedOrigins = [
    FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
];

app.set('trust proxy', 1);
app.use(helmet());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
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
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
});

const OWNER_EMAIL = process.env.OWNER_EMAIL || process.env.EMAIL_USER;

// Render (plano grátis) bloqueia SMTP; com BREVO_API_KEY o envio vai por HTTPS.
async function enviarEmail({ to, subject, html }) {
    if (process.env.BREVO_API_KEY) {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: { name: 'RodBarber', email: process.env.EMAIL_USER }, to: [{ email: to }], subject, htmlContent: html })
        });
        if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
        console.log(`📧 [brevo] e-mail enviado para ${to} (${subject})`);
        return;
    }
    const info = await transporter.sendMail({ from: `RodBarber <${process.env.EMAIL_USER}>`, to, subject, html });
    console.log(`📧 [smtp] e-mail enviado para ${to} (${subject}): ${info.response}`);
}

function notificar(opcoes) {
    enviarEmail(opcoes).catch(err => console.error(`❌ Falha ao enviar e-mail para ${opcoes.to}:`, err.code || '', err.message));
}

function escapeHtml(valor) {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(valor).replace(/[&<>"']/g, c => mapa[c]);
}

function formatarData(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

const PRECOS = {
    'Corte Masculino': 40, 'Barba Completa': 20, 'Corte + Barba': 60,
    'Progressiva + Corte': 120, 'Luzes + Corte': 100, 'Sobrancelha': 10
};

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

function linhaEmail(rotulo, valor, corValor = '#f4efe4') {
    return `<tr><td style="padding:10px 0;color:#9c9484;font-size:13px;border-bottom:1px solid #2b2822;">${rotulo}</td><td style="padding:10px 0;color:${corValor};font-size:15px;font-weight:600;text-align:right;border-bottom:1px solid #2b2822;">${valor}</td></tr>`;
}

function gerarEmailBonito(titulo, subtitulo, detalhes, corDestaque = '#c7a04a', botao = { texto: 'VER MEUS AGENDAMENTOS', link: `${FRONTEND_URL}/meus-agendamentos` }) {
    return `<div style="background-color:#0a0908;padding:36px 16px;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:560px;margin:0 auto;background-color:#151310;border-radius:16px;border:1px solid #2b2822;overflow:hidden;">
<div style="height:4px;background:${corDestaque};"></div>
<div style="padding:30px 30px 8px;text-align:center;">
<div style="color:#c7a04a;font-size:12px;letter-spacing:4px;font-weight:700;">/ RODBARBER</div>
<h1 style="color:#f4efe4;margin:14px 0 8px;font-size:24px;">${titulo}</h1>
<p style="color:#b2a996;margin:0;font-size:15px;line-height:1.5;">${subtitulo}</p>
</div>
<div style="padding:18px 30px 6px;"><table style="width:100%;border-collapse:collapse;">${detalhes}</table></div>
<div style="text-align:center;padding:24px 30px 34px;"><a href="${botao.link}" style="display:inline-block;background-color:${corDestaque};color:#1a1304;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.5px;">${botao.texto}</a></div>
<div style="border-top:1px solid #2b2822;padding:16px 30px;text-align:center;color:#746c5d;font-size:12px;">Barbearia do Rod · Rua Mário Ferraz de Souza, 889 · Cidade Tiradentes, SP</div>
</div></div>`;
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
        const linkReset = `${FRONTEND_URL}/resetar-senha?token=${token}`;
        notificar({
            to: email, subject: 'Recuperar senha - RodBarber',
            html: gerarEmailBonito('Recuperar senha', 'Recebemos um pedido para redefinir sua senha. O link vale por 1 hora.',
                linhaEmail('Conta', escapeHtml(email)), '#c7a04a', { texto: 'REDEFINIR SENHA', link: linkReset })
        });
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
        const { nome, email, data, hora, servico } = req.body;

        if (!nome || !email || !data || !hora || !servico) {
            return res.status(400).json({ mensagem: "Faltam dados." });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) {
            return res.status(400).json({ mensagem: "Data ou horário inválido." });
        }
        const preco = PRECOS[servico];
        if (!preco) return res.status(400).json({ mensagem: "Serviço inválido." });

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
                    success: `${FRONTEND_URL}/meus-agendamentos`,
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

        const nomeSeguro = escapeHtml(nome);
        const linhasTabela =
            linhaEmail('Cliente', nomeSeguro) +
            linhaEmail('Serviço', escapeHtml(servico)) +
            linhaEmail('Data', formatarData(data)) +
            linhaEmail('Horário', escapeHtml(hora)) +
            linhaEmail('Valor', `R$ ${preco},00`, '#2fae6b');
        const htmlBarbeiro = gerarEmailBonito('Novo agendamento', `${nomeSeguro} reservou um horário.`,
            linhasTabela + linhaEmail('Contato', escapeHtml(email)) + linhaEmail('Pagamento', 'Aguardando', '#e8ca8c'),
            '#c7a04a', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` });
        const htmlCliente = gerarEmailBonito('Agendamento recebido', 'Recebemos o seu pedido. Finalize o pagamento para confirmar o horário.', linhasTabela);

        notificar({ to: OWNER_EMAIL, subject: `Novo agendamento: ${nome} - ${formatarData(data)} ${hora}`, html: htmlBarbeiro });
        notificar({ to: email, subject: 'Agendamento recebido - RodBarber', html: htmlCliente });

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
                
                const detalhes =
                    linhaEmail('Serviço', escapeHtml(agendamento.servico)) +
                    linhaEmail('Data', formatarData(agendamento.data)) +
                    linhaEmail('Horário', escapeHtml(agendamento.hora)) +
                    linhaEmail('Valor', `R$ ${agendamento.valor},00`, '#2fae6b');
                notificar({ to: agendamento.email, subject: 'Pagamento confirmado - RodBarber', html: gerarEmailBonito('Pagamento confirmado', 'Seu horário está garantido. Te esperamos!', detalhes, '#2fae6b') });
                notificar({
                    to: OWNER_EMAIL, subject: `Pagamento recebido: ${agendamento.nome}`,
                    html: gerarEmailBonito('Pagamento recebido', `${escapeHtml(agendamento.nome)} pagou o agendamento.`, linhaEmail('Cliente', escapeHtml(agendamento.nome)) + detalhes, '#2fae6b', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
                });
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

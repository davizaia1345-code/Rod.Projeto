require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet());

// --- CONFIGURAÇÃO DE CORS (Segurança) ---
// Na produção, o FRONTEND_URL será o link do seu site na Vercel.
// Enquanto não tem, ele aceita tudo (*) ou o localhost.
const corsOptions = {
    origin: process.env.FRONTEND_URL || "*", 
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Muitas tentativas vindas deste IP, tente novamente mais tarde."
});
app.use(limiter);

app.use(express.json());

const PORT = process.env.PORT || 3001;

// Define a URL do Frontend (Se não tiver no .env, usa localhost)
let FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5500";
if (FRONTEND_URL.endsWith('/')) {
    FRONTEND_URL = FRONTEND_URL.slice(0, -1);
}

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);
const preference = new Preference(client);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Conectado ao Banco de dados com sucesso! ✅'))
  .catch(err => console.error('Erro ao conectar no banco:', err));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: { rejectUnauthorized: false }
});

const Agendamento = mongoose.model('Agendamento', {
  nome: String, email: String, data: String, hora: String, servico: String, valor: Number,
  pagamentoId: String, statusPagamento: String,
  pixCopiaCola: String, qrCodeBase64: String,
  urlPagamentoCartao: String
});

const Usuario = mongoose.model('Usuario', {
  nome: String, email: { type: String, unique: true }, senha: String,
  resetPasswordToken: String, resetPasswordExpires: Date
});

// --- ROTAS DE USUÁRIO ---

app.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    const senhaCripto = await bcrypt.hash(senha, 10);
    const novoUsuario = new Usuario({ nome, email, senha: senhaCripto });
    await novoUsuario.save();
    res.json({ mensagem: 'Usuário cadastrado com sucesso! 👤' });
  } catch (error) { res.status(500).json({ erro: 'Erro ao cadastrar.' }); }
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
        if (!usuario) return res.status(400).json({ erro: 'E-mail não cadastrado.' });

        const token = crypto.randomBytes(20).toString('hex');
        const agora = new Date();
        agora.setHours(agora.getHours() + 1);

        usuario.resetPasswordToken = token;
        usuario.resetPasswordExpires = agora;
        await usuario.save();

        const linkReset = `${FRONTEND_URL}/resetar-senha.html?token=${token}`;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Recuperação de Senha - RodBarber 🔒',
            html: `<p>Clique para redefinir: <a href="${linkReset}">REDEFINIR SENHA</a></p>`
        };
        await transporter.sendMail(mailOptions);
        res.json({ mensagem: 'E-mail de recuperação enviado!' });
    } catch (err) { res.status(500).json({ erro: 'Erro ao processar.' }); }
});

app.post('/resetar-senha', async (req, res) => {
    const { token, novaSenha } = req.body;
    try {
        const usuario = await Usuario.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });
        if (!usuario) return res.status(400).json({ erro: 'Token inválido.' });

        usuario.senha = await bcrypt.hash(novaSenha, 10);
        usuario.resetPasswordToken = undefined;
        usuario.resetPasswordExpires = undefined;
        await usuario.save();
        res.json({ mensagem: 'Senha alterada!' });
    } catch (err) { res.status(500).json({ erro: 'Erro ao redefinir.' }); }
});

// --- ROTAS DE AGENDAMENTO ---

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

        const conflito = await Agendamento.findOne({ data: data, hora: hora });
        if (conflito) return res.status(400).json({ mensagem: "Horário indisponível! ❌" });

        // 1. PIX
        const paymentData = {
            transaction_amount: parseFloat(preco),
            description: `Corte ${servico} - ${data} ${hora}`,
            payment_method_id: 'pix',
            payer: { email: email, first_name: nome }
        };
        const resultPix = await payment.create({ body: paymentData });
        const codigoPix = resultPix.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = resultPix.point_of_interaction.transaction_data.qr_code_base64;
        const idPagamento = resultPix.id;

        // 2. CARTÃO (PREFERENCE) - COM AUTO RETURN ATIVADO PARA PRODUÇÃO
        const preferenceData = {
            items: [{
                title: `${servico} - RodBarber`,
                quantity: 1,
                currency_id: 'BRL',
                unit_price: parseFloat(preco)
            }],
            payer: { email: email, name: nome },
            back_urls: {
                success: `${FRONTEND_URL}/meus-agendamentos.html`, // Redireciona para ver o corte
                failure: `${FRONTEND_URL}/index.html`,
                pending: `${FRONTEND_URL}/index.html`
            },
            auto_return: "approved" // <--- ATIVADO PARA O SITE NO AR
        };
        
        const resultPreference = await preference.create({ body: preferenceData });
        const linkCartao = resultPreference.init_point;

        const novoAgendamento = new Agendamento({ 
            nome, email, data, hora, servico, 
            valor: preco,
            pagamentoId: idPagamento,
            statusPagamento: 'pendente',
            pixCopiaCola: codigoPix,
            qrCodeBase64: qrCodeBase64,
            urlPagamentoCartao: linkCartao
        });
        await novoAgendamento.save();

        // Emails
        const mailOptionsBarbeiro = {
            from: `"Sistema RodBarber" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `📅 NOVO AGENDAMENTO: ${nome}`,
            html: `<p>Novo cliente: ${nome} - ${data} às ${hora}</p>`
        };
        transporter.sendMail(mailOptionsBarbeiro).catch(err => console.log(err));

        const mailOptionsCliente = {
            from: `"Barbearia do Rod" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Agendamento Confirmado - Barbearia do Rod ✅',
            html: `<p>Olá ${nome}, seu horário está reservado: ${data} às ${hora}.</p>`
        };
        transporter.sendMail(mailOptionsCliente).catch(err => console.log(err));

        res.status(201).json({ 
            mensagem: "Agendamento criado!", 
            pixCopiaCola: codigoPix,
            qrCodeBase64: qrCodeBase64,
            idPagamento: idPagamento,
            urlPagamentoCartao: linkCartao
        });

    } catch (err) {
        console.error("Erro:", err);
        res.status(500).json({ mensagem: "Erro ao agendar." });
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

                const mailOptionsPagamento = {
                    from: `"Sistema RodBarber" <${process.env.EMAIL_USER}>`,
                    to: process.env.EMAIL_USER,
                    subject: `💸 PAGOU! - ${agendamento.nome}`,
                    html: `<p>O cliente ${agendamento.nome} pagou R$ ${agendamento.valor}.</p>`
                };
                transporter.sendMail(mailOptionsPagamento).catch(err => console.log(err));
            }
        }
        res.json({ status: status });
    } catch (error) {
        res.status(500).json({ status: 'error' });
    }
});

app.get('/agendamentos', async (req, res) => {
  try { const lista = await Agendamento.find(); res.json(lista); } catch (error) { res.status(500).json({ erro: 'Erro' }); }
});

app.get('/meus-agendamentos', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ erro: 'Email?' });
    const lista = await Agendamento.find({ email: email });
    res.json(lista);
  } catch (error) { res.status(500).json({ erro: 'Erro' }); }
});

app.delete('/agendamentos/:id', async (req, res) => {
  try { await Agendamento.findByIdAndDelete(req.params.id); res.json({ mensagem: 'Ok' }); } catch (error) { res.status(500).json({ erro: 'Erro' }); }
});

app.get('/', (req, res) => res.send('API RodBarber Online 🚀'));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet());

const corsOptions = {
    origin: process.env.FRONTEND_URL || "http://127.0.0.1:5500",
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
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5500";

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

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
    tls: {
        rejectUnauthorized: false
    }
});

const Agendamento = mongoose.model('Agendamento', {
  nome: String,
  email: String,
  data: String,
  hora: String,
  servico: String,
  valor: Number,
  pagamentoId: String,
  statusPagamento: String
});

const Usuario = mongoose.model('Usuario', {
  nome: String,
  email: { type: String, unique: true },
  senha: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date
});

app.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    const senhaCripto = await bcrypt.hash(senha, 10);
    const novoUsuario = new Usuario({ nome, email, senha: senhaCripto });
    await novoUsuario.save();
    res.json({ mensagem: 'Usuário cadastrado com sucesso! 👤' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao cadastrar: e-mail já existe.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(400).json({ erro: 'E-mail não encontrado' });

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) return res.status(400).json({ erro: 'Senha incorreta' });

    res.json({
      mensagem: 'Login realizado com sucesso! ✅',
      usuario: { nome: usuario.nome, email: usuario.email }
    });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
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
            html: `
                <div style="font-family: Arial; color: #333; padding: 20px;">
                    <h2 style="color: #e62e2e;">Esqueceu sua senha?</h2>
                    <p>Clique no botão abaixo para criar uma nova:</p>
                    <a href="${linkReset}" style="background: #e62e2e; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">REDEFINIR SENHA</a>
                </div>
            `
        };
        await transporter.sendMail(mailOptions);
        res.json({ mensagem: 'E-mail de recuperação enviado!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao processar recuperação.' });
    }
});

app.post('/resetar-senha', async (req, res) => {
    const { token, novaSenha } = req.body;
    try {
        const usuario = await Usuario.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });
        if (!usuario) return res.status(400).json({ erro: 'Token inválido ou expirado.' });

        const senhaCripto = await bcrypt.hash(novaSenha, 10);
        usuario.senha = senhaCripto;
        usuario.resetPasswordToken = undefined;
        usuario.resetPasswordExpires = undefined;
        await usuario.save();
        res.json({ mensagem: 'Senha alterada com sucesso!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao redefinir senha.' });
    }
});

app.get('/agendamentos/ocupados', async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ mensagem: "Data é obrigatória" });
    try {
        const agendamentos = await Agendamento.find({ data: data });
        const horariosOcupados = agendamentos.map(ag => ag.hora);
        res.json(horariosOcupados);
    } catch (error) {
        res.status(500).json({ mensagem: "Erro ao buscar horários." });
    }
});

app.post('/agendar', async (req, res) => {
    try {
        const { nome, email, data, hora, servico, preco } = req.body;

        const conflito = await Agendamento.findOne({ data: data, hora: hora });
        if (conflito) return res.status(400).json({ mensagem: "Este horário acabou de ser reservado! ❌" });

        const paymentData = {
            transaction_amount: parseFloat(preco),
            description: `Corte ${servico} - ${data} ${hora}`,
            payment_method_id: 'pix',
            payer: { email: email, first_name: nome }
        };

        const result = await payment.create({ body: paymentData });
        const codigoPix = result.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = result.point_of_interaction.transaction_data.qr_code_base64;
        const idPagamento = result.id;

        const novoAgendamento = new Agendamento({ 
            nome, email, data, hora, servico, 
            valor: preco,
            pagamentoId: idPagamento,
            statusPagamento: 'pendente' 
        });
        await novoAgendamento.save();

        const mailOptionsCliente = {
            from: `"Barbearia do Rod" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Agendamento Confirmado - Barbearia do Rod ✅',
            html: `
                <div style="font-family: Arial; padding: 20px; border: 1px solid #ccc;">
                    <h2 style="color: #d4af37;">Olá, ${nome}!</h2>
                    <p>Seu horário está reservado.</p>
                    <p>📅 <strong>${data}</strong> às <strong>${hora}</strong></p>
                    <p>✂️ Serviço: ${servico}</p>
                    <p>💲 Valor: R$ ${preco},00</p>
                </div>
            `
        };

        const mailOptionsBarbeiro = {
            from: `"Sistema RodBarber" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: `🔔 NOVO AGENDAMENTO: ${nome}`,
            html: `
                <div style="font-family: Arial; padding: 20px; background-color: #f4f4f4;">
                    <h2 style="color: #e62e2e;">🔔 Novo Agendamento!</h2>
                    <p>👤 <strong>Cliente:</strong> ${nome}</p>
                    <p>✂️ <strong>Serviço:</strong> ${servico}</p>
                    <p>📅 <strong>Data:</strong> ${data} - ${hora}</p>
                    <p>💲 <strong>Valor:</strong> R$ ${preco},00</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptionsCliente);
        await transporter.sendMail(mailOptionsBarbeiro);

        res.status(201).json({ 
            mensagem: "Agendamento criado!", 
            pixCopiaCola: codigoPix,
            qrCodeBase64: qrCodeBase64,
            idPagamento: idPagamento
        });

    } catch (err) {
        console.error("Erro no agendamento:", err);
        res.status(500).json({ mensagem: "Erro ao gerar PIX ou salvar agendamento." });
    }
});

app.get('/status-pagamento/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const response = await payment.get({ id: id });
        
        const status = response.status;

        if(status === 'approved') {
            await Agendamento.findOneAndUpdate({ pagamentoId: id }, { statusPagamento: 'approved' });
        }

        res.json({ status: status });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error' });
    }
});

app.get('/agendamentos', async (req, res) => {
  try {
    const lista = await Agendamento.find();
    res.json(lista);
  } catch (error) { res.status(500).json({ erro: 'Erro ao buscar dados' }); }
});

app.get('/meus-agendamentos', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ erro: 'E-mail obrigatório' });
    const lista = await Agendamento.find({ email: email });
    res.json(lista);
  } catch (error) { res.status(500).json({ erro: 'Erro ao buscar' }); }
});

app.delete('/agendamentos/:id', async (req, res) => {
  try {
    await Agendamento.findByIdAndDelete(req.params.id);
    res.json({ mensagem: 'Agendamento removido!' });
  } catch (error) { res.status(500).json({ erro: 'Erro ao excluir' }); }
});

app.get('/', (req, res) => res.send('Back-end online e seguro! 🔒'));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
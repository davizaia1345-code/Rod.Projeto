const bcrypt = require('bcrypt');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const app = express();

app.use(cors());
app.use(express.json());

const MONGO_URI = "mongodb+srv://davizaia1345_db_user:Senha123@cluster0.fzjse5t.mongodb.net/barbearia?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado ao Banco de dados com sucesso! ✅'))
  .catch(err => console.error('Erro ao conectar no banco:', err));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'rdbarbercontato@gmail.com',
        pass: 'dvamkapedjwkjniv'
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
  servico: String
});

const Usuario = mongoose.model('Usuario', {
  nome: String,
  email: { type: String, unique: true },
  senha: String
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
        const { nome, email, data, hora, servico } = req.body;

        const conflito = await Agendamento.findOne({ data: data, hora: hora });
        if (conflito) {
            return res.status(400).json({ mensagem: "Este horário acabou de ser reservado! ❌" });
        }

        const novoAgendamento = new Agendamento({ nome, email, data, hora, servico });
        await novoAgendamento.save();

        const mailOptionsCliente = {
            from: '"Barbearia do Rod" <rdbarbercontato@gmail.com>',
            to: email,
            subject: 'Agendamento Confirmado - Barbearia do Rod ✅',
            html: `
                <div style="font-family: Arial; padding: 20px; border: 1px solid #ccc;">
                    <h2 style="color: #d4af37;">Olá, ${nome}!</h2>
                    <p>Seu horário está confirmado.</p>
                    <p>📅 <strong>${data}</strong> às <strong>${hora}</strong></p>
                    <p>✂️ Serviço: ${servico}</p>
                    <p>Te esperamos lá!</p>
                </div>
            `
        };

        const mailOptionsBarbeiro = {
            from: '"Sistema RodBarber" <rdbarbercontato@gmail.com>',
            to: 'rdbarbercontato@gmail.com',
            subject: `🔔 NOVO CLIENTE: ${nome} às ${hora}`,
            html: `
                <div style="font-family: Arial; padding: 20px; background-color: #f4f4f4;">
                    <h2 style="color: #e62e2e;">🔔 Novo Agendamento!</h2>
                    <p>Um cliente acabou de marcar um horário:</p>
                    <hr>
                    <p>👤 <strong>Cliente:</strong> ${nome}</p>
                    <p>📧 <strong>E-mail:</strong> ${email}</p>
                    <p>✂️ <strong>Serviço:</strong> ${servico}</p>
                    <p>📅 <strong>Data:</strong> ${data}</p>
                    <p>⏰ <strong>Horário:</strong> ${hora}</p>
                    <hr>
                    <p>Acesse o painel admin para ver mais detalhes.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptionsCliente);
        console.log("E-mail do Cliente enviado.");

        await transporter.sendMail(mailOptionsBarbeiro);
        console.log("Alerta do Barbeiro enviado.");

        res.status(201).json({ mensagem: "Agendamento realizado com sucesso! ✅" });

    } catch (err) {
        console.error("Erro no agendamento:", err);
        res.status(201).json({ mensagem: "Agendamento salvo (possível erro no envio de e-mail)." });
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

app.get('/', (req, res) => res.send('Back-end online!'));

app.listen(3001, () => console.log('🚀 Servidor rodando na porta 3001'));
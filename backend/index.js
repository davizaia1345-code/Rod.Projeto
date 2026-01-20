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
  hora: String
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


app.post('/agendar', async (req, res) => {
    try {
        const { nome, email, data, hora } = req.body; 

        
        const conflito = await Agendamento.findOne({ data: data, hora: hora });
        if (conflito) {
            return res.status(400).json({ mensagem: "Este horário já está reservado! ❌" });
        }

        
        const novoAgendamento = new Agendamento({ nome, email, data, hora });
        await novoAgendamento.save();

        
        const mailOptions = {
            from: '"Barbearia do Rod ✂️" <rdbarbercontato@gmail.com>',
            to: email, 
            subject: 'Confirmação de Agendamento - Barbearia do Rod ✂️',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; border: 1px solid #ddd; padding: 20px;">
                    <h2 style="color: #d4af37;">Olá, ${nome}!</h2>
                    <p>Seu horário na <strong>Barbearia do Rod</strong> foi confirmado com sucesso!</p>
                    <hr>
                    <p>📅 <strong>Data:</strong> ${data}</p>
                    <p>⏰ <strong>Horário:</strong> ${hora}</p>
                    <p>📍 <strong>Local:</strong> Rua Mário Ferraz de Souza, 889, Cidade Tiradentes</p>
                    <hr>
                    <p>Te esperamos para essa experiência!</p>
                </div>
            `
        };

        // 4. Envia o e-mail
        await transporter.sendMail(mailOptions);
        console.log("E-mail enviado com sucesso para: " + email);
        
        res.status(201).json({ mensagem: "Agendamento realizado e e-mail enviado! ✅" });
    } catch (err) {
        console.error("Erro detalhado no envio:", err);
        
        res.status(201).json({ mensagem: "Agendamento salvo, mas houve erro no envio do e-mail." });
    }
}); 


app.get('/agendamentos', async (req, res) => {
  try {
    const lista = await Agendamento.find();
    res.json(lista);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar dados' });
  }
});


app.get('/meus-agendamentos', async (req, res) => {
  try {
    const { email } = req.query; 
    if (!email) return res.status(400).json({ erro: 'E-mail é obrigatório' });

    const lista = await Agendamento.find({ email: email }); 
    res.json(lista);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
});

app.delete('/agendamentos/:id', async (req, res) => {
  try {
    await Agendamento.findByIdAndDelete(req.params.id);
    res.json({ mensagem: 'Agendamento removido!' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir' });
  }
});

app.get('/', (req, res) => res.send('Back-end online!'));

app.listen(3001, () => console.log('Servidor rodando em http://localhost:3001'));
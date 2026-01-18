const bcrypt = require('bcrypt');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); 
const app = express();

app.use(cors());
app.use(express.json());

const MONGO_URI = "mongodb+srv://davizaia1345_db_user:Senha123@cluster0.fzjse5t.mongodb.net/barbearia?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado ao Banco de dados com sucesso! ✅'))
  .catch(err => console.error('Erro ao conectar no banco:', err));

// --- MODELOS ---
const Agendamento = mongoose.model('Agendamento', {
  nome: String,
  data: String,
  hora: String
});

const Usuario = mongoose.model('Usuario', {
  nome: String,
  email: { type: String, unique: true },
  senha: String
});

// --- ROTAS DE USUÁRIO (Login/Cadastro) ---
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

// --- ROTAS DE AGENDAMENTO ---
app.get('/agendamentos', async (req, res) => {
  try {
    const lista = await Agendamento.find();
    res.json(lista);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar dados' });
  }
});

app.post('/agendar', async (req, res) => {
    try {
        const { nome, data, hora } = req.body;

        // 1. BUSCA: Verifica se já existe um agendamento igual no banco
        const conflito = await Agendamento.findOne({ data: data, hora: hora });

        if (conflito) {
            // Se achou alguém, para aqui e avisa o usuário
            return res.status(400).json({ mensagem: "Este horário já está reservado por outro cliente! ❌" });
        }

        // 2. CRIAÇÃO: Se o horário estiver livre, salva o novo
        const novoAgendamento = new Agendamento({ nome, data, hora });
        await novoAgendamento.save();
        
        res.status(201).json({ mensagem: "Agendamento realizado com sucesso! ✅" });
    } catch (err) {
        res.status(500).json({ mensagem: "Erro no servidor ao agendar." });
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

// --- INICIALIZAÇÃO (Sempre por último) ---
app.listen(3001, () => console.log('Servidor rodando em http://localhost:3001'));
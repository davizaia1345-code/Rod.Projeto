require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

const app = express();

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://127.0.0.1:5500').replace(/\/$/, '');

if (!process.env.MP_ACCESS_TOKEN || !process.env.MONGO_URI) {
    console.error('Erro: Variáveis de ambiente não configuradas.');
    process.exit(1);
}

const OWNER_EMAIL = (process.env.OWNER_EMAIL || process.env.EMAIL_USER || '').trim().toLowerCase();

// Defina JWT_SECRET no Render para um segredo próprio; sem ele, deriva-se um das outras variáveis secretas.
if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET não definido: usando segredo derivado das variáveis de ambiente.');
const JWT_SECRET = process.env.JWT_SECRET ||
    crypto.createHash('sha256').update(`rodbarber|${process.env.MONGO_URI}|${process.env.MP_ACCESS_TOKEN}`).digest('hex');

const COLLATION = { locale: 'en', strength: 2 };
const BCRYPT_CUSTO = 12;
const DUMMY_HASH = bcrypt.hashSync('rodbarber-dummy-password', BCRYPT_CUSTO);

const PRECOS = {
    'Corte Masculino': 40, 'Barba Completa': 20, 'Corte + Barba': 60,
    'Progressiva + Corte': 120, 'Luzes + Corte': 100, 'Sobrancelha': 10
};

const HORARIOS = new Set();
[[9 * 60, 11 * 60 + 30], [13 * 60, 21 * 60 + 30]].forEach(([ini, fim]) => {
    for (let t = ini; t <= fim; t += 35) {
        HORARIOS.add(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normEmail = v => str(v, 254).toLowerCase();
const emailValido = e => e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);
const senhaValida = s => typeof s === 'string' && s.length >= 8 && Buffer.byteLength(s) <= 72;
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const erro = (res, status, msg) => res.status(status).json({ erro: msg, mensagem: msg });

function mascarar(email) {
    const [u = '', d = ''] = String(email).split('@');
    return `${u.slice(0, 2)}***@${d}`;
}

function logSeg(evento, req, extra = {}) {
    console.warn(JSON.stringify({ tipo: 'seguranca', evento, ip: req && req.ip, rota: req && `${req.method} ${req.path}`, ...extra }));
}

function escapeHtml(valor) {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(valor).replace(/[&<>"']/g, c => mapa[c]);
}

function formatarData(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

function agoraSP() {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
    return { data: `${p.year}-${p.month}-${p.day}`, minutos: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}

function dataReal(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// ---------------------------------------------------------------------------
// E-mail (HTTPS via Brevo; o Render grátis bloqueia SMTP)
// ---------------------------------------------------------------------------

async function enviarEmail({ to, subject, html }) {
    if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY não configurada');
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'RodBarber', email: process.env.EMAIL_USER }, to: [{ email: to }], subject, htmlContent: html }),
        signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
    console.log(`📧 [brevo] e-mail enviado para ${mascarar(to)} (${subject})`);
}

function notificar(opcoes) {
    enviarEmail(opcoes).catch(err => console.error(`❌ Falha ao enviar e-mail para ${mascarar(opcoes.to)}:`, err.message));
}

function linhaEmail(rotulo, valor, corValor = '#f4efe4') {
    // o Gmail transforma e-mails em links azuis; um <a> com estilo próprio mantém a cor da marca
    if (String(valor).includes('@')) valor = `<a href="mailto:${valor}" style="color:${corValor};text-decoration:none;">${valor}</a>`;
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
<div style="border-top:1px solid #2b2822;padding:16px 30px;text-align:center;color:#746c5d;font-size:12px;"><a href="https://www.google.com/maps/search/?api=1&query=Rua+M%C3%A1rio+Ferraz+de+Souza+889+Cidade+Tiradentes+SP" style="color:#746c5d;text-decoration:none;">Barbearia do Rod · Rua Mário Ferraz de Souza, 889 · Cidade Tiradentes, SP</a></div>
</div></div>`;
}

// ---------------------------------------------------------------------------
// Configuração do Express (A02: headers, CORS restrito, limites)
// ---------------------------------------------------------------------------

app.set('trust proxy', 1);
app.use(helmet());

const allowedOrigins = [FRONTEND_URL];
if (process.env.ALLOW_DEV_ORIGINS === 'true') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://127.0.0.1:3000', 'http://localhost:8935');
}

app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
}));

const limitadorGeral = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
    skip: req => req.path.startsWith('/status-pagamento'),
    handler: (req, res) => { logSeg('rate_limit_geral', req); erro(res, 429, 'Muitas requisições. Tente novamente em alguns minutos.'); }
});
const limitadorAuth = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true,
    handler: (req, res) => { logSeg('rate_limit_auth', req); erro(res, 429, 'Muitas tentativas. Tente novamente em 15 minutos.'); }
});
const limitadorPagamento = rateLimit({
    windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => erro(res, 429, 'Muitas consultas. Aguarde um instante.')
});
app.use(limitadorGeral);
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// Banco de dados
// ---------------------------------------------------------------------------

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);
const preference = new Preference(client);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Banco de Dados Conectado!'))
    .catch(err => console.error('❌ Erro no Banco:', err));

const agendamentoSchema = new mongoose.Schema({
    nome: String, email: String, data: String, hora: String, servico: String, valor: Number,
    pagamentoId: String, statusPagamento: String, pixCopiaCola: String, qrCodeBase64: String, urlPagamentoCartao: String
});
agendamentoSchema.index({ data: 1, hora: 1 }, { unique: true });
const Agendamento = mongoose.model('Agendamento', agendamentoSchema);
Agendamento.init().catch(err => console.error('⚠️  Índice único de horários não criado:', err.message));

const Usuario = mongoose.model('Usuario', {
    nome: String, email: { type: String, unique: true }, senha: String,
    resetPasswordToken: String, resetPasswordExpires: Date
});

// ---------------------------------------------------------------------------
// Autenticação por token assinado (A01/A07)
// ---------------------------------------------------------------------------

function assinarToken(payload) {
    const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const assinatura = crypto.createHmac('sha256', JWT_SECRET).update(corpo).digest('base64url');
    return `${corpo}.${assinatura}`;
}

function lerToken(token) {
    if (typeof token !== 'string') return null;
    const [corpo, assinatura, extra] = token.split('.');
    if (!corpo || !assinatura || extra !== undefined) return null;
    const esperado = crypto.createHmac('sha256', JWT_SECRET).update(corpo).digest();
    const recebido = Buffer.from(assinatura, 'base64url');
    if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return null;
    try {
        const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
        return p && p.exp > Date.now() / 1000 ? p : null;
    } catch { return null; }
}

function exigirLogin(req, res, next) {
    const cab = req.headers.authorization || '';
    const p = lerToken(cab.startsWith('Bearer ') ? cab.slice(7) : '');
    if (!p) { logSeg('sem_token_valido', req); return erro(res, 401, 'Sessão expirada. Faça login novamente.'); }
    req.usuario = { email: p.sub, nome: p.nome, dono: p.role === 'owner' };
    next();
}

function exigirDono(req, res, next) {
    if (!req.usuario.dono) { logSeg('acesso_negado_dono', req, { email: mascarar(req.usuario.email) }); return erro(res, 403, 'Acesso restrito ao proprietário.'); }
    next();
}

const donoDoAgendamento = (req, ag) => req.usuario.dono || String(ag.email).toLowerCase() === req.usuario.email;

// bloqueio por tentativas de login (por IP + e-mail, para não permitir travar a conta de terceiros)
const falhasLogin = new Map();
const JANELA_LOGIN = 15 * 60 * 1000, MAX_FALHAS = 5;
const loginBloqueado = chave => {
    const f = falhasLogin.get(chave);
    if (!f) return false;
    if (Date.now() - f.desde > JANELA_LOGIN) { falhasLogin.delete(chave); return false; }
    return f.n >= MAX_FALHAS;
};
const registrarFalha = chave => {
    const f = falhasLogin.get(chave);
    if (!f || Date.now() - f.desde > JANELA_LOGIN) { falhasLogin.set(chave, { n: 1, desde: Date.now() }); return 1; }
    return ++f.n;
};
setInterval(() => {
    for (const [k, f] of falhasLogin) if (Date.now() - f.desde > JANELA_LOGIN) falhasLogin.delete(k);
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/cadastro', limitadorAuth, async (req, res) => {
    try {
        const nome = str(req.body && req.body.nome, 80).replace(/[\u0000-\u001f<>]/g, '');
        const email = normEmail(req.body && req.body.email);
        const senha = req.body && req.body.senha;
        if (nome.length < 2) return erro(res, 400, 'Informe seu nome.');
        if (!emailValido(email)) return erro(res, 400, 'Informe um e-mail válido.');
        if (!senhaValida(senha)) return erro(res, 400, 'A senha precisa ter de 8 a 72 caracteres.');

        if (await Usuario.findOne({ email }).collation(COLLATION)) return erro(res, 409, 'E-mail já cadastrado.');
        await new Usuario({ nome, email, senha: await bcrypt.hash(senha, BCRYPT_CUSTO) }).save();
        res.json({ mensagem: 'Usuário cadastrado!' });
    } catch (err) {
        if (err && err.code === 11000) return erro(res, 409, 'E-mail já cadastrado.');
        console.error('ERRO NO CADASTRO:', err.message);
        erro(res, 500, 'Erro ao cadastrar. Tente novamente.');
    }
});

app.post('/login', limitadorAuth, async (req, res) => {
    try {
        const email = normEmail(req.body && req.body.email);
        const senha = req.body && req.body.senha;
        if (!email || typeof senha !== 'string' || !senha || senha.length > 72) return erro(res, 400, 'Informe e-mail e senha.');

        const chave = `${req.ip}|${email}`;
        if (loginBloqueado(chave)) { logSeg('login_bloqueado', req, { email: mascarar(email) }); return erro(res, 429, 'Muitas tentativas. Tente novamente em 15 minutos.'); }

        const usuario = await Usuario.findOne({ email }).collation(COLLATION);
        const senhaOk = await bcrypt.compare(senha, usuario ? usuario.senha : DUMMY_HASH);
        if (!usuario || !senhaOk) {
            const n = registrarFalha(chave);
            logSeg('login_falhou', req, { email: mascarar(email), tentativas: n });
            if (n === MAX_FALHAS && email === OWNER_EMAIL) {
                notificar({
                    to: OWNER_EMAIL, subject: 'Alerta de segurança - RodBarber',
                    html: gerarEmailBonito('Tentativas de acesso suspeitas', 'Houve várias tentativas de login com senha errada na sua conta. Se não foi você, altere sua senha.',
                        linhaEmail('Tentativas', String(n)) + linhaEmail('Origem (IP)', escapeHtml(req.ip)), '#cf4a40', { texto: 'ALTERAR SENHA', link: `${FRONTEND_URL}/esqueci-senha` })
                });
            }
            return erro(res, 401, 'E-mail ou senha incorretos.');
        }
        falhasLogin.delete(chave);

        const emailUsuario = usuario.email.toLowerCase();
        const dono = emailUsuario === OWNER_EMAIL;
        const token = assinarToken({
            sub: emailUsuario, nome: usuario.nome, role: dono ? 'owner' : 'client',
            exp: Math.floor(Date.now() / 1000) + (dono ? 8 * 3600 : 7 * 24 * 3600)
        });
        res.json({ mensagem: 'Login OK', token, usuario: { nome: usuario.nome, email: usuario.email, dono } });
    } catch (err) {
        console.error('ERRO NO LOGIN:', err.message);
        erro(res, 500, 'Erro no login. Tente novamente.');
    }
});

app.post('/esqueci-senha', limitadorAuth, async (req, res) => {
    try {
        const email = normEmail(req.body && req.body.email);
        if (!emailValido(email)) return erro(res, 400, 'Informe um e-mail válido.');

        const usuario = await Usuario.findOne({ email }).collation(COLLATION);
        if (usuario) {
            const token = crypto.randomBytes(32).toString('hex');
            usuario.resetPasswordToken = sha256(token);
            usuario.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
            await usuario.save();
            notificar({
                to: usuario.email, subject: 'Recuperar senha - RodBarber',
                html: gerarEmailBonito('Recuperar senha', 'Recebemos um pedido para redefinir sua senha. O link vale por 1 hora.',
                    linhaEmail('Conta', escapeHtml(usuario.email)), '#c7a04a', { texto: 'REDEFINIR SENHA', link: `${FRONTEND_URL}/resetar-senha?token=${token}` })
            });
        } else {
            logSeg('reset_email_inexistente', req, { email: mascarar(email) });
        }
        // mesma resposta existindo ou não, para não revelar quais e-mails têm conta
        res.json({ mensagem: 'Se este e-mail estiver cadastrado, enviamos o link de redefinição.' });
    } catch (err) {
        console.error('ERRO NO ESQUECI-SENHA:', err.message);
        erro(res, 500, 'Erro ao processar. Tente novamente.');
    }
});

app.post('/resetar-senha', limitadorAuth, async (req, res) => {
    try {
        const token = str(req.body && req.body.token, 128);
        const novaSenha = req.body && req.body.novaSenha;
        if (!token) return erro(res, 400, 'Link inválido ou expirado.');
        if (!senhaValida(novaSenha)) return erro(res, 400, 'A senha precisa ter de 8 a 72 caracteres.');

        const usuario = await Usuario.findOne({ resetPasswordToken: sha256(token), resetPasswordExpires: { $gt: new Date() } });
        if (!usuario) { logSeg('reset_token_invalido', req); return erro(res, 400, 'Link inválido ou expirado.'); }

        usuario.senha = await bcrypt.hash(novaSenha, BCRYPT_CUSTO);
        usuario.resetPasswordToken = undefined;
        usuario.resetPasswordExpires = undefined;
        await usuario.save();
        logSeg('senha_redefinida', req, { email: mascarar(usuario.email) });
        res.json({ mensagem: 'Senha alterada!' });
    } catch (err) {
        console.error('ERRO NO RESETAR-SENHA:', err.message);
        erro(res, 500, 'Erro ao alterar a senha. Tente novamente.');
    }
});

app.get('/agendamentos/ocupados', async (req, res) => {
    try {
        const data = req.query.data;
        if (typeof data !== 'string' || !dataReal(data)) return erro(res, 400, 'Data inválida.');
        const lista = await Agendamento.find({ data }).select('hora');
        res.json(lista.map(ag => ag.hora));
    } catch (err) {
        console.error('ERRO AO BUSCAR HORÁRIOS:', err.message);
        erro(res, 500, 'Erro ao buscar a agenda.');
    }
});

app.post('/agendar', exigirLogin, async (req, res) => {
    try {
        // nome e e-mail vêm do token: ninguém agenda em nome de outra pessoa nem usa o sistema para mandar e-mail a terceiros
        const { nome, email } = req.usuario;
        const servico = str(req.body && req.body.servico, 60);
        const data = str(req.body && req.body.data, 10);
        const hora = str(req.body && req.body.hora, 5);

        if (!servico || !data || !hora) return erro(res, 400, 'Faltam dados.');
        if (!Object.prototype.hasOwnProperty.call(PRECOS, servico)) return erro(res, 400, 'Serviço inválido.');
        if (!dataReal(data) || !HORARIOS.has(hora)) return erro(res, 400, 'Data ou horário inválido.');

        const agora = agoraSP();
        const limite = new Date(`${agora.data}T00:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 90);
        if (data < agora.data || data > limite.toISOString().slice(0, 10)) return erro(res, 400, 'Escolha uma data entre hoje e os próximos 90 dias.');
        const [h, m] = hora.split(':').map(Number);
        if (data === agora.data && h * 60 + m <= agora.minutos) return erro(res, 400, 'Esse horário já passou.');

        const pendentes = await Agendamento.countDocuments({ email, statusPagamento: 'pendente', data: { $gte: agora.data } }).collation(COLLATION);
        if (pendentes >= 3) return erro(res, 429, 'Você já tem 3 agendamentos aguardando pagamento. Pague ou cancele algum para marcar outro.');

        if (await Agendamento.findOne({ data, hora })) return erro(res, 400, 'Horário já reservado!');

        const preco = PRECOS[servico];
        const descricao = `Corte ${servico} - ${data} ${hora}`;
        const pixResult = await payment.create({
            body: { transaction_amount: preco, description: descricao, payment_method_id: 'pix', payer: { email, first_name: nome } }
        });
        const codigoPix = pixResult.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = pixResult.point_of_interaction.transaction_data.qr_code_base64;
        const idPagamento = pixResult.id;

        const prefResult = await preference.create({
            body: {
                items: [{ title: descricao, quantity: 1, unit_price: preco, currency_id: 'BRL' }],
                payer: { email, name: nome },
                back_urls: { success: `${FRONTEND_URL}/meus-agendamentos`, failure: `${FRONTEND_URL}/`, pending: `${FRONTEND_URL}/` }
            }
        });
        const linkCartao = prefResult.init_point;

        try {
            await new Agendamento({
                nome, email, data, hora, servico, valor: preco,
                pagamentoId: idPagamento.toString(), statusPagamento: 'pendente',
                pixCopiaCola: codigoPix, qrCodeBase64, urlPagamentoCartao: linkCartao
            }).save();
        } catch (err) {
            if (err && err.code === 11000) return erro(res, 400, 'Horário já reservado!');
            throw err;
        }

        res.status(201).json({ mensagem: 'Criado!', pixCopiaCola: codigoPix, qrCodeBase64, idPagamento, urlPagamentoCartao: linkCartao });

        const nomeSeguro = escapeHtml(nome);
        const linhasTabela =
            linhaEmail('Cliente', nomeSeguro) +
            linhaEmail('Serviço', escapeHtml(servico)) +
            linhaEmail('Data', formatarData(data)) +
            linhaEmail('Horário', escapeHtml(hora)) +
            linhaEmail('Valor', `R$ ${preco},00`, '#2fae6b');
        notificar({
            to: OWNER_EMAIL, subject: `Novo agendamento: ${nome} - ${formatarData(data)} ${hora}`,
            html: gerarEmailBonito('Novo agendamento', `${nomeSeguro} reservou um horário.`,
                linhasTabela + linhaEmail('Contato', escapeHtml(email)) + linhaEmail('Pagamento', 'Aguardando', '#e8ca8c'),
                '#c7a04a', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
        });
        notificar({
            to: email, subject: 'Agendamento recebido - RodBarber',
            html: gerarEmailBonito('Agendamento recebido', 'Recebemos o seu pedido. Finalize o pagamento para confirmar o horário.', linhasTabela)
        });
    } catch (err) {
        console.error('ERRO NO AGENDAMENTO:', err.message);
        if (!res.headersSent) erro(res, 500, 'Erro no servidor ao criar pagamento.');
    }
});

app.get('/status-pagamento/:id', limitadorPagamento, exigirLogin, async (req, res) => {
    try {
        const id = req.params.id;
        if (!/^\d{3,20}$/.test(id)) return erro(res, 400, 'Pagamento inválido.');

        const agendamento = await Agendamento.findOne({ pagamentoId: id });
        if (!agendamento) return erro(res, 404, 'Pagamento não encontrado.');
        if (!donoDoAgendamento(req, agendamento)) { logSeg('acesso_negado_pagamento', req, { email: mascarar(req.usuario.email) }); return erro(res, 403, 'Acesso negado.'); }

        const status = (await payment.get({ id })).status;
        if (status === 'approved' && agendamento.statusPagamento !== 'approved') {
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
        res.json({ status });
    } catch (err) {
        console.error('ERRO NO STATUS DO PAGAMENTO:', err.message);
        erro(res, 500, 'Erro ao consultar o pagamento.');
    }
});

app.get('/agendamentos', exigirLogin, exigirDono, async (req, res) => {
    try {
        res.json(await Agendamento.find().select('-qrCodeBase64 -pixCopiaCola -urlPagamentoCartao'));
    } catch (err) {
        console.error('ERRO AO LISTAR AGENDAMENTOS:', err.message);
        erro(res, 500, 'Erro ao listar os agendamentos.');
    }
});

app.get('/meus-agendamentos', exigirLogin, async (req, res) => {
    try {
        res.json(await Agendamento.find({ email: req.usuario.email }).collation(COLLATION));
    } catch (err) {
        console.error('ERRO AO LISTAR MEUS AGENDAMENTOS:', err.message);
        erro(res, 500, 'Erro ao listar seus agendamentos.');
    }
});

app.delete('/agendamentos/:id', exigirLogin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const agendamento = await Agendamento.findById(req.params.id);
        if (!agendamento) return erro(res, 404, 'Agendamento não encontrado.');
        if (!donoDoAgendamento(req, agendamento)) { logSeg('exclusao_negada', req, { email: mascarar(req.usuario.email) }); return erro(res, 403, 'Acesso negado.'); }

        await agendamento.deleteOne();
        logSeg('agendamento_excluido', req, { por: mascarar(req.usuario.email), data: agendamento.data, hora: agendamento.hora });
        res.json({ mensagem: 'Ok' });
    } catch (err) {
        console.error('ERRO AO EXCLUIR AGENDAMENTO:', err.message);
        erro(res, 500, 'Erro ao excluir o agendamento.');
    }
});

// ---------------------------------------------------------------------------
// Erros (A10): sem vazar detalhes internos
// ---------------------------------------------------------------------------

app.use((req, res) => erro(res, 404, 'Rota não encontrada.'));

app.use((err, req, res, next) => {
    console.error('ERRO NÃO TRATADO:', err.type || '', err.message);
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode;
    if (status === 413) return erro(res, 413, 'Requisição grande demais.');
    if (status >= 400 && status < 500) return erro(res, status, 'Requisição inválida.');
    erro(res, 500, 'Erro interno do servidor.');
});

process.on('unhandledRejection', motivo => console.error('unhandledRejection:', motivo));
process.on('uncaughtException', err => console.error('uncaughtException:', err));

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));

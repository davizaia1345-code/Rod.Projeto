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

const DURACOES = {
    'Corte Masculino': 40, 'Barba Completa': 20, 'Corte + Barba': 60,
    'Progressiva + Corte': 120, 'Luzes + Corte': 90, 'Sobrancelha': 10
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

const ENDERECO = 'Rua Mário Ferraz de Souza, 889, Cidade Tiradentes, São Paulo - SP';

function linkGoogleAgenda(ag) {
    const dia = String(ag.data).replace(/-/g, '');
    const [h, m] = String(ag.hora).split(':').map(Number);
    const fim = h * 60 + m + duracaoDe(ag.servico);
    const q = new URLSearchParams({
        action: 'TEMPLATE', text: `${ag.servico} - Barbearia do Rod`,
        dates: `${dia}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00/${dia}T${String(Math.floor(fim / 60) % 24).padStart(2, '0')}${String(fim % 60).padStart(2, '0')}00`,
        ctz: 'America/Sao_Paulo', location: ENDERECO, details: 'Agendamento na Barbearia do Rod.'
    });
    return `https://calendar.google.com/calendar/render?${q}`;
}
const linhaAgenda = ag => linhaEmail('Lembrete', `<a href="${escapeHtml(linkGoogleAgenda(ag))}" style="color:#e8ca8c;text-decoration:none;">Adicionar ao Google Agenda</a>`);

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
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
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
    pagamentoId: String, statusPagamento: String, pixCopiaCola: String, qrCodeBase64: String, urlPagamentoCartao: String,
    referencia: String, pagamentoManual: String, lembreteEnviado: Boolean
});
agendamentoSchema.index({ data: 1, hora: 1 }, { unique: true });
const Agendamento = mongoose.model('Agendamento', agendamentoSchema);
Agendamento.init().catch(err => console.error('⚠️  Índice único de horários não criado:', err.message));

// serviços e preços editáveis pelo proprietário (os valores acima são o padrão inicial)
const ICONES = ['fa-scissors', 'fa-user-tie', 'fa-star', 'fa-eye', 'fa-wind', 'fa-wand-magic-sparkles', 'fa-spray-can-sparkles', 'fa-child', 'fa-crown', 'fa-gem', 'fa-bolt', 'fa-fire'];
const Servico = mongoose.model('Servico', new mongoose.Schema({
    nome: { type: String, unique: true }, preco: Number, minutos: Number, icone: String, ativo: { type: Boolean, default: true }, ordem: Number
}));
let servicosCache = new Map();
const ICONES_PADRAO = { 'Corte Masculino': 'fa-scissors', 'Barba Completa': 'fa-user-tie', 'Corte + Barba': 'fa-star', 'Sobrancelha': 'fa-eye', 'Progressiva + Corte': 'fa-wind', 'Luzes + Corte': 'fa-wand-magic-sparkles' };
const ORDEM_PADRAO = ['Corte Masculino', 'Barba Completa', 'Corte + Barba', 'Sobrancelha', 'Progressiva + Corte', 'Luzes + Corte'];

async function carregarServicos() {
    if (await Servico.estimatedDocumentCount() === 0) {
        await Servico.insertMany(ORDEM_PADRAO.map((nome, i) => ({ nome, preco: PRECOS[nome], minutos: DURACOES[nome], icone: ICONES_PADRAO[nome], ativo: true, ordem: i + 1 })), { ordered: false }).catch(err => { if (!err || err.code !== 11000) throw err; });
    }
    const lista = await Servico.find().sort({ ordem: 1, nome: 1 }).lean();
    servicosCache = new Map(lista.map(x => [x.nome, x]));
}
// enquanto o cache não carrega (ou se o banco falhar), valem os padrões
const precoAtivo = nome => {
    if (!servicosCache.size) return Object.prototype.hasOwnProperty.call(PRECOS, nome) ? PRECOS[nome] : undefined;
    const x = servicosCache.get(nome);
    return x && x.ativo ? x.preco : undefined;
};
const duracaoDe = nome => (servicosCache.get(nome) && servicosCache.get(nome).minutos) || DURACOES[nome] || 40;
const listaServicosPadrao = () => ORDEM_PADRAO.map(nome => ({ nome, preco: PRECOS[nome], minutos: DURACOES[nome], icone: ICONES_PADRAO[nome] }));
mongoose.connection.once('open', () => { carregarServicos().catch(err => console.error('⚠️  Serviços não carregados (valem os padrões):', err.message)); });
setInterval(() => carregarServicos().catch(() => {}), 5 * 60 * 1000).unref();

// folgas e horários bloqueados pelo proprietário (hora vazia = dia inteiro)
const bloqueioSchema = new mongoose.Schema({ data: String, hora: { type: String, default: '' }, motivo: String }, { timestamps: true });
bloqueioSchema.index({ data: 1, hora: 1 }, { unique: true });
const Bloqueio = mongoose.model('Bloqueio', bloqueioSchema);
Bloqueio.init().catch(err => console.error('⚠️  Índice de bloqueios não criado:', err.message));

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

// ---------------------------------------------------------------------------
// Pagamento pendente: o horário é liberado se não for pago a tempo
// ---------------------------------------------------------------------------

const HORAS_ANTECEDENCIA = Number(process.env.LIBERAR_PENDENTES_HORAS ?? 2);   // libera X horas antes do corte
const CARENCIA_MIN = Number(process.env.LIBERAR_CARENCIA_MIN ?? 30);            // tempo mínimo para pagar após reservar
const INTERVALO_LIBERACAO_S = Number(process.env.LIBERAR_INTERVALO_S ?? 60);

const inicioDoAgendamento = ag => Date.parse(`${ag.data}T${ag.hora}:00-03:00`); // Brasília (UTC-3, sem horário de verão)
const limiteDePagamento = ag => Math.max(
    inicioDoAgendamento(ag) - HORAS_ANTECEDENCIA * 3600e3,
    ag._id.getTimestamp().getTime() + CARENCIA_MIN * 60e3
);

async function confirmarPagamento(ag, { avisarDono = true } = {}) {
    await Agendamento.findOneAndUpdate({ _id: ag._id }, { statusPagamento: 'approved' });
    const detalhes =
        linhaEmail('Serviço', escapeHtml(ag.servico)) +
        linhaEmail('Data', formatarData(ag.data)) +
        linhaEmail('Horário', escapeHtml(ag.hora)) +
        linhaEmail('Valor', brl(ag.valor), '#2fae6b');
    notificar({ to: ag.email, subject: 'Pagamento confirmado - RodBarber', html: gerarEmailBonito('Pagamento confirmado', 'Seu horário está garantido. Te esperamos!', detalhes + linhaAgenda(ag), '#2fae6b') });
    if (avisarDono) notificar({
        to: OWNER_EMAIL, subject: `Pagamento recebido: ${ag.nome}`,
        html: gerarEmailBonito('Pagamento recebido', `${escapeHtml(ag.nome)} pagou o agendamento.`, linhaEmail('Cliente', escapeHtml(ag.nome)) + detalhes, '#2fae6b', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
    });
}

// Encerra o PIX pendente e diz se o Mercado Pago tem algum pagamento aprovado (PIX ou cartão) para a reserva.
// Se a consulta falhar, lança erro: quem chama deve manter a reserva.
async function pagamentoAprovado(ag) {
    if (ag.pagamentoId) { try { await payment.cancel({ id: ag.pagamentoId }); } catch (e) { /* já pago, expirado ou cancelado: a consulta abaixo decide */ } }
    if (!ag.referencia) return false;
    const busca = await payment.search({ options: { external_reference: ag.referencia } });
    return (busca.results || []).some(p => p.status === 'approved');
}

// Só apaga se o Mercado Pago confirmar que NÃO existe pagamento aprovado (PIX ou cartão). Na dúvida, mantém.
async function liberarPendentesVencidos() {
    const agora = Date.now();
    const pendentes = await Agendamento.find({ statusPagamento: 'pendente', referencia: { $type: 'string' } });
    for (const ag of pendentes) {
        if (agora < limiteDePagamento(ag)) continue;
        try {
            if (await pagamentoAprovado(ag)) {
                console.log(`💰 Pagamento aprovado encontrado ao liberar pendente (${ag.data} ${ag.hora}); confirmando.`);
                await confirmarPagamento(ag);
                continue;
            }
            await ag.deleteOne();
            console.log(JSON.stringify({ tipo: 'agenda', evento: 'pendente_liberado', data: ag.data, hora: ag.hora, cliente: mascarar(ag.email) }));
            notificar({
                to: ag.email, subject: 'Horário liberado - RodBarber',
                html: gerarEmailBonito('Horário liberado', 'O pagamento não foi identificado a tempo, então a vaga voltou para a agenda. Você pode agendar de novo quando quiser.',
                    linhaEmail('Serviço', escapeHtml(ag.servico)) + linhaEmail('Data', formatarData(ag.data)) + linhaEmail('Horário', escapeHtml(ag.hora)),
                    '#c7a04a', { texto: 'AGENDAR NOVAMENTE', link: FRONTEND_URL })
            });
        } catch (err) {
            console.error(`⚠️  Não foi possível conferir o pagamento de ${ag.data} ${ag.hora}; horário mantido:`, err.message);
        }
    }
}

let liberacaoEmCurso = null, liberacaoUltima = 0;
function garantirLiberacao() {
    if (liberacaoEmCurso) return liberacaoEmCurso;
    if (Date.now() - liberacaoUltima < INTERVALO_LIBERACAO_S * 1000) return Promise.resolve();
    liberacaoEmCurso = liberarPendentesVencidos()
        .catch(err => console.error('Erro ao liberar pendentes:', err.message))
        .finally(() => { liberacaoUltima = Date.now(); liberacaoEmCurso = null; });
    return liberacaoEmCurso;
}
setInterval(garantirLiberacao, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Caixa: atendimentos avulsos (balcão) e relatório mensal
// ---------------------------------------------------------------------------

const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', outro: 'Outro' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const Atendimento = mongoose.model('Atendimento', new mongoose.Schema({
    nome: String, servico: String, valor: Number, forma: String, data: String, hora: String, observacao: String
}, { timestamps: true }));
const Relatorio = mongoose.model('Relatorio', new mongoose.Schema({ mes: { type: String, unique: true }, enviadoEm: Date }));

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const brl = v => 'R$ ' + r2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesValido = m => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const mesAnterior = mes => { let [a, m] = mes.split('-').map(Number); m--; if (m === 0) { m = 12; a--; } return `${a}-${String(m).padStart(2, '0')}`; };
const nomeDoMes = mes => { const [a, m] = mes.split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };
const limpar = (v, max) => str(v, max).replace(/[\u0000-\u001f<>]/g, '');

async function lancamentosDoMes(mes) {
    const faixa = { $gte: `${mes}-01`, $lte: `${mes}-31` };
    const [online, balcao, pendentes] = await Promise.all([
        Agendamento.find({ statusPagamento: 'approved', data: faixa }).select('data servico valor pagamentoManual'),
        Atendimento.find({ data: faixa }).select('data servico valor forma'),
        Agendamento.find({ statusPagamento: 'pendente', data: faixa }).select('valor')
    ]);
    return { online, balcao, pendentes };
}

async function calcularRelatorio(mes) {
    const { online, balcao, pendentes } = await lancamentosDoMes(mes);
    const soma = lista => lista.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const porServico = {}, porForma = {}, porDia = {};
    const somar = (obj, chave, v) => { const o = obj[chave] || (obj[chave] = { qtd: 0, total: 0 }); o.qtd++; o.total += v; };
    online.forEach(x => { const v = Number(x.valor) || 0; somar(porServico, x.servico, v); somar(porForma, x.pagamentoManual ? (FORMAS[x.pagamentoManual] || 'Outro') : 'Online (site)', v); porDia[x.data] = (porDia[x.data] || 0) + v; });
    balcao.forEach(x => { const v = Number(x.valor) || 0; somar(porServico, x.servico, v); somar(porForma, FORMAS[x.forma] || 'Outro', v); porDia[x.data] = (porDia[x.data] || 0) + v; });
    const lista = obj => Object.entries(obj).map(([nome, o]) => ({ nome, qtd: o.qtd, total: r2(o.total) })).sort((a, b) => b.total - a.total);

    const total = soma(online) + soma(balcao);
    const qtd = online.length + balcao.length;
    const dias = Object.entries(porDia).sort((a, b) => b[1] - a[1]);
    const ant = await lancamentosDoMes(mesAnterior(mes));
    const totalAnterior = soma(ant.online) + soma(ant.balcao);

    return {
        mes, nomeMes: nomeDoMes(mes),
        total: r2(total), totalOnline: r2(soma(online)), totalBalcao: r2(soma(balcao)),
        atendimentos: qtd, atendimentosOnline: online.length, atendimentosBalcao: balcao.length,
        ticketMedio: qtd ? r2(total / qtd) : 0,
        porServico: lista(porServico), porForma: lista(porForma),
        melhorDia: dias[0] ? { data: dias[0][0], total: r2(dias[0][1]) } : null,
        diasComMovimento: dias.length,
        totalMesAnterior: r2(totalAnterior),
        variacaoPercentual: totalAnterior > 0 ? Math.round((total - totalAnterior) / totalAnterior * 1000) / 10 : null,
        aguardandoPagamento: { qtd: pendentes.length, total: r2(soma(pendentes)) }
    };
}

function emailRelatorio(r) {
    const secao = titulo => `<tr><td colspan="2" style="padding:22px 0 4px;color:#c7a04a;font-size:11px;letter-spacing:2px;font-weight:700;text-transform:uppercase;">${titulo}</td></tr>`;
    const variacao = r.variacaoPercentual === null ? 'sem dados do mês anterior para comparar'
        : `${r.variacaoPercentual >= 0 ? '▲' : '▼'} ${Math.abs(r.variacaoPercentual).toLocaleString('pt-BR')}% em relação ao mês anterior (${brl(r.totalMesAnterior)})`;
    let detalhes =
        linhaEmail('Faturamento total', brl(r.total), '#2fae6b') +
        linhaEmail('Pelo site (PIX/cartão)', `${brl(r.totalOnline)} · ${r.atendimentosOnline}`) +
        linhaEmail('No balcão (avulsos)', `${brl(r.totalBalcao)} · ${r.atendimentosBalcao}`) +
        linhaEmail('Atendimentos', String(r.atendimentos)) +
        linhaEmail('Ticket médio', brl(r.ticketMedio)) +
        linhaEmail('Dias com movimento', String(r.diasComMovimento)) +
        (r.melhorDia ? linhaEmail('Melhor dia', `${formatarData(r.melhorDia.data)} · ${brl(r.melhorDia.total)}`) : '');
    if (r.porServico.length) detalhes += secao('Por serviço') + r.porServico.map(s => linhaEmail(escapeHtml(s.nome), `${s.qtd}× · ${brl(s.total)}`)).join('');
    if (r.porForma.length) detalhes += secao('Forma de pagamento') + r.porForma.map(f => linhaEmail(escapeHtml(f.nome), `${f.qtd}× · ${brl(f.total)}`)).join('');
    if (r.aguardandoPagamento.qtd) detalhes += secao('Atenção') + linhaEmail('Reservas sem pagamento', `${r.aguardandoPagamento.qtd} · ${brl(r.aguardandoPagamento.total)}`, '#e8ca8c');
    return {
        subject: `Relatório de ${r.nomeMes} - RodBarber`,
        html: gerarEmailBonito(`Relatório de ${r.nomeMes}`, `Faturamento de ${brl(r.total)}. ${variacao}.`, detalhes, '#c7a04a', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
    };
}

// Envio automático no começo de cada mês (o serviço grátis dorme: a checagem roda a cada acesso e de hora em hora)
const INTERVALO_RELATORIO_S = Number(process.env.RELATORIO_INTERVALO_S ?? 3600);
let relatorioUltimo = 0, relatorioEmCurso = null;

async function verificarRelatorioMensal() {
    const hoje = agoraSP().data;
    const anterior = mesAnterior(hoje.slice(0, 7));
    // primeira execução: só registra o mês anterior como referência, sem mandar um relatório "surpresa" no deploy
    if (await Relatorio.estimatedDocumentCount() === 0) {
        await Relatorio.create({ mes: anterior, enviadoEm: null });
        console.log(`📊 Relatório mensal: referência inicial registrada (${anterior}). O primeiro envio automático será no mês que vem.`);
        return;
    }
    try { await Relatorio.create({ mes: anterior }); } catch (err) { if (err.code === 11000) return; throw err; }
    try {
        const { subject, html } = emailRelatorio(await calcularRelatorio(anterior));
        await enviarEmail({ to: OWNER_EMAIL, subject, html });
        await Relatorio.updateOne({ mes: anterior }, { enviadoEm: new Date() });
        console.log(`📊 Relatório de ${anterior} enviado ao proprietário.`);
    } catch (err) {
        await Relatorio.deleteOne({ mes: anterior });   // libera para tentar de novo na próxima checagem
        console.error(`⚠️  Relatório de ${anterior} não enviado; tentará de novo:`, err.message);
    }
}

function garantirRelatorioMensal() {
    if (relatorioEmCurso || Date.now() - relatorioUltimo < INTERVALO_RELATORIO_S * 1000) return;
    relatorioUltimo = Date.now();
    relatorioEmCurso = verificarRelatorioMensal()
        .catch(err => console.error('Erro na checagem do relatório mensal:', err.message))
        .finally(() => { relatorioEmCurso = null; });
}
setInterval(garantirRelatorioMensal, 60 * 60 * 1000).unref();
mongoose.connection.once('open', () => setTimeout(garantirRelatorioMensal, 3000).unref());
app.use((req, res, next) => { garantirRelatorioMensal(); next(); });

// ---------------------------------------------------------------------------
// Avisos automáticos: lembrete para o cliente e agenda do dia para o dono
// ---------------------------------------------------------------------------

const LEMBRETE_HORAS = Number(process.env.LEMBRETE_ANTECEDENCIA_H ?? 2);   // lembra o cliente X horas antes
const AGENDA_DIA_HORA = Number(process.env.AGENDA_DIA_HORA ?? 7);           // a partir de que hora o dono recebe a agenda do dia
const AGENDA_DIA_ATE = Number(process.env.AGENDA_DIA_ATE ?? 20);            // depois dessa hora já não faz sentido enviar
const INTERVALO_AVISOS_S = Number(process.env.AVISOS_INTERVALO_S ?? 300);
const AgendaDia = mongoose.model('AgendaDia', new mongoose.Schema({ dia: { type: String, unique: true }, enviadoEm: Date }));

async function enviarLembretes() {
    const agora = Date.now();
    const hoje = agoraSP().data;
    const amanha = new Date(`${hoje}T00:00:00Z`); amanha.setUTCDate(amanha.getUTCDate() + 1);
    const candidatos = await Agendamento.find({ statusPagamento: 'approved', lembreteEnviado: { $ne: true }, data: { $in: [hoje, amanha.toISOString().slice(0, 10)] } });
    for (const ag of candidatos) {
        const falta = inicioDoAgendamento(ag) - agora;
        if (falta <= 0 || falta > LEMBRETE_HORAS * 3600e3) continue;
        if (agora - ag._id.getTimestamp().getTime() < 60 * 60e3) continue;   // acabou de reservar: lembrar seria redundante
        const r = await Agendamento.updateOne({ _id: ag._id, lembreteEnviado: { $ne: true } }, { lembreteEnviado: true });
        if (!r.modifiedCount) continue;                                       // outra execução já cuidou deste
        const quando = ag.data === hoje ? `hoje às ${ag.hora}` : `amanhã às ${ag.hora}`;
        const detalhes =
            linhaEmail('Serviço', escapeHtml(ag.servico)) +
            linhaEmail('Quando', escapeHtml(quando)) +
            linhaEmail('Local', `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ENDERECO)}" style="color:#f4efe4;text-decoration:none;">Rua Mário Ferraz de Souza, 889</a>`) +
            linhaAgenda(ag);
        notificar({
            to: ag.email, subject: `Lembrete: seu corte é ${quando} - RodBarber`,
            html: gerarEmailBonito('Seu horário está chegando', `Olá, ${escapeHtml(String(ag.nome).split(' ')[0])}! Te esperamos ${escapeHtml(quando)}.`, detalhes, '#c7a04a', { texto: 'COMO CHEGAR', link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ENDERECO)}` })
        });
        console.log(JSON.stringify({ tipo: 'agenda', evento: 'lembrete_enviado', data: ag.data, hora: ag.hora, cliente: mascarar(ag.email) }));
    }
}

async function enviarAgendaDoDia() {
    const { data, minutos } = agoraSP();
    if (minutos < AGENDA_DIA_HORA * 60 || minutos > AGENDA_DIA_ATE * 60) return;
    try { await AgendaDia.create({ dia: data }); } catch (err) { if (err.code === 11000) return; throw err; }
    const lista = await Agendamento.find({ data }).sort({ hora: 1 });
    if (!lista.length) return;
    try {
        const pagos = lista.filter(a => a.statusPagamento === 'approved');
        const total = lista.reduce((s, a) => s + (Number(a.valor) || 0), 0);
        const linhas = lista.map(a => linhaEmail(escapeHtml(a.hora), `${escapeHtml(a.nome)} · ${escapeHtml(a.servico)} · ${a.statusPagamento === 'approved' ? 'Pago' : 'Pendente'}`, a.statusPagamento === 'approved' ? '#f4efe4' : '#e8ca8c')).join('') +
            linhaEmail('Previsto no dia', brl(total), '#2fae6b');
        await enviarEmail({
            to: OWNER_EMAIL, subject: `Agenda de hoje: ${lista.length} cliente${lista.length === 1 ? '' : 's'} - RodBarber`,
            html: gerarEmailBonito('Agenda de hoje', `${lista.length} cliente${lista.length === 1 ? '' : 's'} marcado${lista.length === 1 ? '' : 's'} para ${formatarData(data)}, ${pagos.length} já pago${pagos.length === 1 ? '' : 's'}.`, linhas, '#c7a04a', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
        });
        console.log(`📅 Agenda do dia enviada ao proprietário (${lista.length}).`);
    } catch (err) {
        await AgendaDia.deleteOne({ dia: data });   // tenta de novo na próxima checagem
        console.error('⚠️  Agenda do dia não enviada; tentará de novo:', err.message);
    }
}

let avisosUltimo = 0, avisosEmCurso = null;
function garantirAvisos() {
    if (avisosEmCurso || Date.now() - avisosUltimo < INTERVALO_AVISOS_S * 1000) return;
    avisosUltimo = Date.now();
    avisosEmCurso = Promise.resolve()
        .then(enviarLembretes).catch(err => console.error('Erro nos lembretes:', err.message))
        .then(enviarAgendaDoDia).catch(err => console.error('Erro na agenda do dia:', err.message))
        .finally(() => { avisosEmCurso = null; });
}
setInterval(garantirAvisos, 5 * 60 * 1000).unref();
mongoose.connection.once('open', () => setTimeout(garantirAvisos, 5000).unref());
app.use((req, res, next) => { garantirAvisos(); next(); });

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/cadastro', limitadorAuth, async (req, res) => {
    try {
        const nome = str(req.body && req.body.nome, 80).replace(/[\u0000-\u001f<>]/g, '');
        const email = normEmail(req.body && req.body.email);
        const senha = req.body && req.body.senha;
        if (nome.length < 2) return erro(res, 400, 'Informe seu nome.');
        if (!emailValido(email)) return erro(res, 400, 'Informe um e-mail válido.');
        if (!senhaValida(senha)) return erro(res, 400, 'A senha precisa ter de 8 a 72 caracteres.');

        // a conta do proprietário não pode ser criada pelo cadastro público
        if (email === OWNER_EMAIL && process.env.ALLOW_OWNER_SIGNUP !== 'true') { logSeg('cadastro_email_do_dono', req); return erro(res, 409, 'E-mail já cadastrado.'); }
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
        await garantirLiberacao();
        const [lista, bloqueios] = await Promise.all([Agendamento.find({ data }).select('hora'), Bloqueio.find({ data }).select('hora')]);
        const horas = new Set(lista.map(ag => ag.hora));
        if (bloqueios.some(b => b.hora === '')) HORARIOS.forEach(h => horas.add(h));
        else bloqueios.forEach(b => horas.add(b.hora));
        res.json([...horas]);
    } catch (err) {
        console.error('ERRO AO BUSCAR HORÁRIOS:', err.message);
        erro(res, 500, 'Erro ao buscar a agenda.');
    }
});

// agenda de um dia para a tela de agendamento: usa o relógio do servidor (Brasília) para esconder horários que já passaram
app.get('/agenda', async (req, res) => {
    try {
        const data = req.query.data;
        if (typeof data !== 'string' || !dataReal(data)) return erro(res, 400, 'Data inválida.');
        await garantirLiberacao();
        const [lista, bloqueios] = await Promise.all([Agendamento.find({ data }).select('hora'), Bloqueio.find({ data }).select('hora motivo')]);
        const diaBloqueado = bloqueios.find(b => b.hora === '');
        const agora = agoraSP();
        res.json({
            data, hoje: agora.data, minutosAgora: agora.minutos,
            ocupados: lista.map(ag => ag.hora),
            bloqueados: diaBloqueado ? [...HORARIOS] : bloqueios.map(b => b.hora),
            diaFechado: Boolean(diaBloqueado)
        });
    } catch (err) {
        console.error('ERRO AO BUSCAR AGENDA:', err.message);
        erro(res, 500, 'Erro ao buscar a agenda.');
    }
});

app.post('/agendar', exigirLogin, async (req, res) => {
    try {
        // a conta do proprietário só acessa o painel
        if (req.usuario.dono) return erro(res, 403, 'A conta do proprietário acessa apenas o painel.');
        // nome e e-mail vêm do token: ninguém agenda em nome de outra pessoa nem usa o sistema para mandar e-mail a terceiros
        const { nome, email } = req.usuario;
        await garantirLiberacao();
        const servico = str(req.body && req.body.servico, 60);
        const data = str(req.body && req.body.data, 10);
        const hora = str(req.body && req.body.hora, 5);

        if (!servico || !data || !hora) return erro(res, 400, 'Faltam dados.');
        if (precoAtivo(servico) === undefined) return erro(res, 400, 'Serviço inválido ou indisponível.');
        if (!dataReal(data) || !HORARIOS.has(hora)) return erro(res, 400, 'Data ou horário inválido.');

        const agora = agoraSP();
        const limite = new Date(`${agora.data}T00:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 90);
        if (data < agora.data || data > limite.toISOString().slice(0, 10)) return erro(res, 400, 'Escolha uma data entre hoje e os próximos 90 dias.');
        const [h, m] = hora.split(':').map(Number);
        if (data === agora.data && h * 60 + m <= agora.minutos) return erro(res, 400, 'Esse horário já passou.');

        const pendentes = await Agendamento.countDocuments({ email, statusPagamento: 'pendente', data: { $gte: agora.data } }).collation(COLLATION);
        if (pendentes >= 3) return erro(res, 429, 'Você já tem 3 agendamentos aguardando pagamento. Pague ou cancele algum para marcar outro.');

        if (await Agendamento.findOne({ data, hora })) return erro(res, 400, 'Horário já reservado!');
        if (await Bloqueio.findOne({ data, hora: { $in: ['', hora] } })) return erro(res, 400, 'Esse horário não está disponível.');

        const preco = precoAtivo(servico);
        const descricao = `Corte ${servico} - ${data} ${hora}`;
        // a referência liga o agendamento aos pagamentos no Mercado Pago (PIX e cartão)
        const referencia = crypto.randomUUID();
        const pixResult = await payment.create({
            body: { transaction_amount: preco, description: descricao, payment_method_id: 'pix', external_reference: referencia, payer: { email, first_name: nome } }
        });
        const codigoPix = pixResult.point_of_interaction.transaction_data.qr_code;
        const qrCodeBase64 = pixResult.point_of_interaction.transaction_data.qr_code_base64;
        const idPagamento = pixResult.id;

        const prefBase = {
            items: [{ title: descricao, quantity: 1, unit_price: preco, currency_id: 'BRL' }],
            payer: { email, name: nome },
            external_reference: referencia,
            back_urls: { success: `${FRONTEND_URL}/meus-agendamentos`, failure: `${FRONTEND_URL}/`, pending: `${FRONTEND_URL}/` }
        };
        const prazo = Math.max(inicioDoAgendamento({ data, hora }) - HORAS_ANTECEDENCIA * 3600e3, Date.now() + CARENCIA_MIN * 60e3);
        let prefResult;
        try {
            // o link do cartão deixa de valer no mesmo prazo em que a vaga é liberada
            prefResult = await preference.create({ body: { ...prefBase, expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: new Date(prazo).toISOString() } });
        } catch (err) {
            console.warn('⚠️  Preferência com prazo recusada; criando sem prazo:', err.message);
            prefResult = await preference.create({ body: prefBase });
        }
        const linkCartao = prefResult.init_point;

        try {
            await new Agendamento({
                nome, email, data, hora, servico, valor: preco,
                pagamentoId: idPagamento.toString(), statusPagamento: 'pendente',
                pixCopiaCola: codigoPix, qrCodeBase64, urlPagamentoCartao: linkCartao, referencia
            }).save();
        } catch (err) {
            if (err && err.code === 11000) return erro(res, 400, 'Horário já reservado!');
            throw err;
        }

        res.status(201).json({ mensagem: 'Criado!', pixCopiaCola: codigoPix, qrCodeBase64, idPagamento, urlPagamentoCartao: linkCartao, pagarAte: new Date(prazo).toISOString() });

        const nomeSeguro = escapeHtml(nome);
        const linhasTabela =
            linhaEmail('Cliente', nomeSeguro) +
            linhaEmail('Serviço', escapeHtml(servico)) +
            linhaEmail('Data', formatarData(data)) +
            linhaEmail('Horário', escapeHtml(hora)) +
            linhaEmail('Valor', brl(preco), '#2fae6b');
        notificar({
            to: OWNER_EMAIL, subject: `Novo agendamento: ${nome} - ${formatarData(data)} ${hora}`,
            html: gerarEmailBonito('Novo agendamento', `${nomeSeguro} reservou um horário.`,
                linhasTabela + linhaEmail('Contato', escapeHtml(email)) + linhaEmail('Pagamento', 'Aguardando', '#e8ca8c'),
                '#c7a04a', { texto: 'ABRIR PAINEL', link: `${FRONTEND_URL}/admin` })
        });
        notificar({
            to: email, subject: 'Agendamento recebido - RodBarber',
            html: gerarEmailBonito('Agendamento recebido', 'Recebemos o seu pedido. Finalize o pagamento para confirmar o horário.', linhasTabela + linhaAgenda({ data, hora, servico }))
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
        if (status === 'approved' && agendamento.statusPagamento !== 'approved') await confirmarPagamento(agendamento);
        res.json({ status });
    } catch (err) {
        console.error('ERRO NO STATUS DO PAGAMENTO:', err.message);
        erro(res, 500, 'Erro ao consultar o pagamento.');
    }
});

app.get('/agendamentos', exigirLogin, exigirDono, async (req, res) => {
    try {
        await garantirLiberacao();
        res.json(await Agendamento.find().select('-qrCodeBase64 -pixCopiaCola -urlPagamentoCartao -referencia'));
    } catch (err) {
        console.error('ERRO AO LISTAR AGENDAMENTOS:', err.message);
        erro(res, 500, 'Erro ao listar os agendamentos.');
    }
});

app.get('/meus-agendamentos', exigirLogin, async (req, res) => {
    try {
        if (req.usuario.dono) return erro(res, 403, 'A conta do proprietário acessa apenas o painel.');
        await garantirLiberacao();
        const lista = await Agendamento.find({ email: req.usuario.email }).collation(COLLATION);
        res.json(lista.map(ag => {
            const item = ag.toObject();
            // pagarAte: até quando a vaga fica reservada sem pagamento (só agendamentos ligados ao Mercado Pago)
            if (ag.statusPagamento === 'pendente' && ag.referencia) item.pagarAte = new Date(limiteDePagamento(ag)).toISOString();
            delete item.referencia;
            return item;
        }));
    } catch (err) {
        console.error('ERRO AO LISTAR MEUS AGENDAMENTOS:', err.message);
        erro(res, 500, 'Erro ao listar seus agendamentos.');
    }
});

// --- caixa (somente o proprietário) ---

const limitadorRelatorio = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res) => erro(res, 429, 'Limite de envios de relatório atingido. Tente em uma hora.')
});

app.post('/atendimentos', exigirLogin, exigirDono, async (req, res) => {
    try {
        const b = req.body || {};
        const servico = limpar(b.servico, 60);
        const valor = typeof b.valor === 'number' || typeof b.valor === 'string' ? Number(b.valor) : NaN;
        const forma = typeof b.forma === 'string' ? b.forma : '';
        if (!servico) return erro(res, 400, 'Informe o serviço.');
        if (!Number.isFinite(valor) || valor <= 0 || valor > 10000) return erro(res, 400, 'Informe um valor entre R$ 0,01 e R$ 10.000,00.');
        if (!Object.prototype.hasOwnProperty.call(FORMAS, forma)) return erro(res, 400, 'Forma de pagamento inválida.');

        const agora = agoraSP();
        const data = b.data === undefined || b.data === '' ? agora.data : str(b.data, 10);
        if (!dataReal(data)) return erro(res, 400, 'Data inválida.');
        const limiteAntigo = new Date(`${agora.data}T00:00:00Z`); limiteAntigo.setUTCDate(limiteAntigo.getUTCDate() - 366);
        if (data > agora.data) return erro(res, 400, 'Atendimento não pode estar no futuro.');
        if (data < limiteAntigo.toISOString().slice(0, 10)) return erro(res, 400, 'Data muito antiga.');
        const horaPadrao = `${String(Math.floor(agora.minutos / 60)).padStart(2, '0')}:${String(agora.minutos % 60).padStart(2, '0')}`;
        const hora = b.hora === undefined || b.hora === '' ? horaPadrao : str(b.hora, 5);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return erro(res, 400, 'Hora inválida.');

        const doc = await Atendimento.create({
            nome: limpar(b.nome, 80), servico, valor: r2(valor), forma, data, hora, observacao: limpar(b.observacao, 120)
        });
        logSeg('atendimento_registrado', req, { valor: doc.valor, forma, data });
        res.status(201).json(doc);
    } catch (err) {
        console.error('ERRO AO REGISTRAR ATENDIMENTO:', err.message);
        erro(res, 500, 'Erro ao registrar o atendimento.');
    }
});

app.get('/atendimentos', exigirLogin, exigirDono, async (req, res) => {
    try {
        res.json(await Atendimento.find().sort({ data: -1, hora: -1 }).limit(1000));
    } catch (err) {
        console.error('ERRO AO LISTAR ATENDIMENTOS:', err.message);
        erro(res, 500, 'Erro ao listar os atendimentos.');
    }
});

app.delete('/atendimentos/:id', exigirLogin, exigirDono, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const doc = await Atendimento.findByIdAndDelete(req.params.id);
        if (!doc) return erro(res, 404, 'Atendimento não encontrado.');
        logSeg('atendimento_excluido', req, { valor: doc.valor, data: doc.data });
        res.json({ mensagem: 'Ok' });
    } catch (err) {
        console.error('ERRO AO EXCLUIR ATENDIMENTO:', err.message);
        erro(res, 500, 'Erro ao excluir o atendimento.');
    }
});

app.get('/relatorio', exigirLogin, exigirDono, async (req, res) => {
    try {
        const mes = req.query.mes === undefined ? agoraSP().data.slice(0, 7) : req.query.mes;
        if (!mesValido(mes)) return erro(res, 400, 'Mês inválido. Use o formato AAAA-MM.');
        res.json(await calcularRelatorio(mes));
    } catch (err) {
        console.error('ERRO AO CALCULAR RELATÓRIO:', err.message);
        erro(res, 500, 'Erro ao calcular o relatório.');
    }
});

app.post('/relatorio/enviar', exigirLogin, exigirDono, limitadorRelatorio, async (req, res) => {
    try {
        const mes = req.body && req.body.mes !== undefined ? req.body.mes : agoraSP().data.slice(0, 7);
        if (!mesValido(mes)) return erro(res, 400, 'Mês inválido. Use o formato AAAA-MM.');
        const { subject, html } = emailRelatorio(await calcularRelatorio(mes));
        await enviarEmail({ to: OWNER_EMAIL, subject, html });
        res.json({ mensagem: `Relatório de ${nomeDoMes(mes)} enviado para ${mascarar(OWNER_EMAIL)}.` });
    } catch (err) {
        console.error('ERRO AO ENVIAR RELATÓRIO:', err.message);
        erro(res, 502, 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
    }
});

// dono recebeu em mãos (dinheiro, maquininha, PIX direto): marca a reserva como paga
app.post('/agendamentos/:id/pago', exigirLogin, exigirDono, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const forma = req.body && typeof req.body.forma === 'string' ? req.body.forma : 'dinheiro';
        if (!Object.prototype.hasOwnProperty.call(FORMAS, forma)) return erro(res, 400, 'Forma de pagamento inválida.');
        const ag = await Agendamento.findById(req.params.id);
        if (!ag) return erro(res, 404, 'Agendamento não encontrado.');
        if (ag.statusPagamento === 'approved') return erro(res, 400, 'Esse agendamento já está pago.');
        try { await pagamentoAprovado(ag); } catch (err) { /* só tenta encerrar o PIX; o pagamento em mãos vale de qualquer forma */ }
        await Agendamento.updateOne({ _id: ag._id }, { pagamentoManual: forma });
        await confirmarPagamento(ag, { avisarDono: false });
        logSeg('pagamento_manual', req, { forma, data: ag.data, hora: ag.hora });
        res.json({ mensagem: 'Ok' });
    } catch (err) {
        console.error('ERRO AO MARCAR COMO PAGO:', err.message);
        erro(res, 500, 'Erro ao marcar como pago.');
    }
});

// --- serviços e preços ---

app.get('/servicos', (req, res) => {
    const ativos = [...servicosCache.values()].filter(x => x.ativo);
    res.set('Cache-Control', 'no-cache');
    res.json(servicosCache.size ? ativos.map(x => ({ nome: x.nome, preco: x.preco, minutos: x.minutos, icone: x.icone })) : listaServicosPadrao());
});

app.get('/servicos/todos', exigirLogin, exigirDono, async (req, res) => {
    try {
        res.json(await Servico.find().sort({ ordem: 1, nome: 1 }));
    } catch (err) {
        console.error('ERRO AO LISTAR SERVIÇOS:', err.message);
        erro(res, 500, 'Erro ao listar os serviços.');
    }
});

function validarServico(b, parcial) {
    const out = {};
    if (!parcial || b.preco !== undefined) {
        const preco = typeof b.preco === 'number' || typeof b.preco === 'string' ? Number(b.preco) : NaN;
        if (!Number.isFinite(preco) || preco < 0.5 || preco > 5000) return { erro: 'Informe um preço entre R$ 0,50 e R$ 5.000,00.' };
        out.preco = r2(preco);
    }
    if (!parcial || b.minutos !== undefined) {
        const min = typeof b.minutos === 'number' || typeof b.minutos === 'string' ? Number(b.minutos) : NaN;
        if (!Number.isInteger(min) || min < 5 || min > 480) return { erro: 'A duração deve ser de 5 a 480 minutos.' };
        out.minutos = min;
    }
    if (!parcial || b.icone !== undefined) {
        const icone = typeof b.icone === 'string' ? b.icone : 'fa-scissors';
        if (!ICONES.includes(icone)) return { erro: 'Ícone inválido.' };
        out.icone = icone;
    }
    if (b.ativo !== undefined) {
        if (typeof b.ativo !== 'boolean') return { erro: 'Valor inválido para ativo.' };
        out.ativo = b.ativo;
    }
    return { dados: out };
}

app.post('/servicos', exigirLogin, exigirDono, async (req, res) => {
    try {
        const b = req.body || {};
        const nome = limpar(b.nome, 40);
        if (nome.length < 2) return erro(res, 400, 'Informe o nome do serviço.');
        const v = validarServico(b, false);
        if (v.erro) return erro(res, 400, v.erro);
        const ultimo = await Servico.findOne().sort({ ordem: -1 }).select('ordem');
        try {
            const doc = await Servico.create({ nome, ...v.dados, ativo: true, ordem: ((ultimo && ultimo.ordem) || 0) + 1 });
            await carregarServicos();
            logSeg('servico_criado', req, { nome, preco: doc.preco });
            res.status(201).json(doc);
        } catch (err) {
            if (err && err.code === 11000) return erro(res, 400, 'Já existe um serviço com esse nome.');
            throw err;
        }
    } catch (err) {
        console.error('ERRO AO CRIAR SERVIÇO:', err.message);
        erro(res, 500, 'Erro ao criar o serviço.');
    }
});

app.put('/servicos/:id', exigirLogin, exigirDono, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const v = validarServico(req.body || {}, true);
        if (v.erro) return erro(res, 400, v.erro);
        if (!Object.keys(v.dados).length) return erro(res, 400, 'Nada para atualizar.');
        if (v.dados.ativo === false && [...servicosCache.values()].filter(x => x.ativo).length <= 1) {
            const alvo = await Servico.findById(req.params.id);
            if (alvo && alvo.ativo) return erro(res, 400, 'Mantenha pelo menos um serviço ativo.');
        }
        const doc = await Servico.findByIdAndUpdate(req.params.id, v.dados, { new: true });
        if (!doc) return erro(res, 404, 'Serviço não encontrado.');
        await carregarServicos();
        logSeg('servico_atualizado', req, { nome: doc.nome, ...v.dados });
        res.json(doc);
    } catch (err) {
        console.error('ERRO AO ATUALIZAR SERVIÇO:', err.message);
        erro(res, 500, 'Erro ao atualizar o serviço.');
    }
});

// --- folgas e horários bloqueados (somente o proprietário) ---

app.get('/bloqueios', exigirLogin, exigirDono, async (req, res) => {
    try {
        const hoje = agoraSP().data;
        res.json(await Bloqueio.find({ data: { $gte: hoje } }).sort({ data: 1, hora: 1 }).limit(500));
    } catch (err) {
        console.error('ERRO AO LISTAR BLOQUEIOS:', err.message);
        erro(res, 500, 'Erro ao listar os bloqueios.');
    }
});

app.post('/bloqueios', exigirLogin, exigirDono, async (req, res) => {
    try {
        const b = req.body || {};
        const data = str(b.data, 10);
        const hora = b.hora === undefined || b.hora === null ? '' : str(b.hora, 5);
        if (!dataReal(data)) return erro(res, 400, 'Data inválida.');
        if (hora !== '' && !HORARIOS.has(hora)) return erro(res, 400, 'Horário inválido.');
        if (data < agoraSP().data) return erro(res, 400, 'Escolha hoje ou uma data futura.');
        const emConflito = await Agendamento.countDocuments(hora ? { data, hora } : { data });
        if (hora && emConflito) return erro(res, 400, 'Já existe um agendamento nesse horário.');
        try {
            const doc = await Bloqueio.create({ data, hora, motivo: limpar(b.motivo, 80) });
            logSeg('bloqueio_criado', req, { data, hora: hora || 'dia inteiro' });
            res.status(201).json({ ...doc.toObject(), agendamentosNoDia: hora ? 0 : emConflito });
        } catch (err) {
            if (err && err.code === 11000) return erro(res, 400, 'Esse bloqueio já existe.');
            throw err;
        }
    } catch (err) {
        console.error('ERRO AO CRIAR BLOQUEIO:', err.message);
        erro(res, 500, 'Erro ao criar o bloqueio.');
    }
});

app.delete('/bloqueios/:id', exigirLogin, exigirDono, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const doc = await Bloqueio.findByIdAndDelete(req.params.id);
        if (!doc) return erro(res, 404, 'Bloqueio não encontrado.');
        logSeg('bloqueio_removido', req, { data: doc.data, hora: doc.hora || 'dia inteiro' });
        res.json({ mensagem: 'Ok' });
    } catch (err) {
        console.error('ERRO AO REMOVER BLOQUEIO:', err.message);
        erro(res, 500, 'Erro ao remover o bloqueio.');
    }
});

app.delete('/agendamentos/:id', exigirLogin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return erro(res, 400, 'Identificador inválido.');
        const agendamento = await Agendamento.findById(req.params.id);
        if (!agendamento) return erro(res, 404, 'Agendamento não encontrado.');
        if (!donoDoAgendamento(req, agendamento)) { logSeg('exclusao_negada', req, { email: mascarar(req.usuario.email) }); return erro(res, 403, 'Acesso negado.'); }

        // cliente não cancela sozinho um horário já pago (não há estorno automático): fala com o Rod
        if (agendamento.statusPagamento === 'approved' && !req.usuario.dono) {
            return erro(res, 403, 'Horários já pagos são cancelados pelo Rod. Fale com ele pelo WhatsApp.');
        }
        // horário pendente: encerra o PIX (para ninguém pagar uma vaga já cancelada) e confere se não foi pago nesse meio tempo
        if (agendamento.statusPagamento !== 'approved') {
            let pago;
            try { pago = await pagamentoAprovado(agendamento); }
            catch (err) { console.error('⚠️  Não foi possível conferir o pagamento antes de cancelar:', err.message); return erro(res, 502, 'Não foi possível conferir o pagamento agora. Tente de novo em instantes.'); }
            if (pago) { await confirmarPagamento(agendamento); return erro(res, 409, 'O pagamento acabou de ser confirmado, então o horário foi mantido.'); }
        }

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

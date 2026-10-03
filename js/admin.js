(function () {
    'use strict';
    const API_URL = 'https://rodbarber-api-0jna.onrender.com';
    let PRECOS = { 'Corte Masculino': 40, 'Barba Completa': 20, 'Corte + Barba': 60, 'Sobrancelha': 10, 'Progressiva + Corte': 120, 'Luzes + Corte': 100 };
    const ICONES = { 'fa-scissors': 'Tesoura', 'fa-user-tie': 'Barba', 'fa-star': 'Estrela', 'fa-eye': 'Sobrancelha', 'fa-wind': 'Progressiva', 'fa-wand-magic-sparkles': 'Mágica', 'fa-spray-can-sparkles': 'Spray', 'fa-child': 'Criança', 'fa-crown': 'Coroa', 'fa-gem': 'Premium', 'fa-bolt': 'Raio', 'fa-fire': 'Fogo' };
    const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', outro: 'Outro' };
    const esc = v => RodAuth.esc(v);
    const $ = id => document.getElementById(id);
    const Tema = Swal.mixin({ background: '#151310', color: '#f4efe4', confirmButtonColor: '#c7a04a', cancelButtonColor: '#2b2822' });
    const toast = (icon, title) => Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 3200, timerProgressBar: true, background: '#1c1a16', color: '#f4efe4' });

    let todosAgendamentos = [];
    let todosAtendimentos = [];
    let folgas = [];
    let idsConhecidos = null;
    let filtroChip = 'proximos';
    let abaAtual = 'agendamentos';

    const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const hojeSP = () => RodUtil.hojeSP(0);
    const horaSP = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const formatarData = d => RodUtil.dataBR(d);
    const chave = a => a.data + ' ' + a.hora;
    const telBR = t => t && t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, t.length - 4)}-${t.slice(-4)}` : '';

    // --- só decide o que mostrar: o servidor recusa (403) qualquer pedido que não seja do dono ---
    function verificarPermissao() {
        if (RodAuth.papel() !== 'owner') {
            document.body.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; color:#e62e2e; text-align:center;">
                    <i class="fas fa-ban" style="font-size: 5em; margin-bottom: 20px;"></i>
                    <h1 style="text-transform:uppercase; font-size:2em;">Acesso Negado</h1>
                    <p style="color:var(--text-faint); margin-top:10px;">Esta área é restrita apenas ao proprietário.</p>
                    <a href="/" style="color:#fff; margin-top:20px; text-decoration:underline;">Voltar ao início</a>
                </div>
            `;
            setTimeout(() => window.location.href = '/', 3000);
            return false;
        }
        return true;
    }

    async function carregarDados(silencioso) {
        if (!verificarPermissao()) return;
        const icone = $('atualizado').firstElementChild;
        icone.classList.add('fa-spin');
        try {
            const [rAg, rAt] = await Promise.all([
                RodAuth.fetch(`${API_URL}/agendamentos`),
                RodAuth.fetch(`${API_URL}/atendimentos`)
            ]);
            if (rAg.status === 403 || rAt.status === 403) { localStorage.removeItem('token'); return verificarPermissao(); }
            if (!rAg.ok || !rAt.ok) throw new Error('falha');
            const novos = (await rAg.json());
            todosAtendimentos = await rAt.json();

            // avisa de reservas que chegaram desde a última atualização
            if (idsConhecidos) {
                novos.filter(a => !idsConhecidos.has(a._id)).forEach(a => toast('info', `Novo agendamento: ${a.nome} · ${formatarData(a.data)} ${a.hora}`));
            }
            idsConhecidos = new Set(novos.map(a => a._id));
            todosAgendamentos = novos;

            $('atualizado-txt').textContent = 'Atualizado às ' + horaSP();
            desenharTudo();
            if (abaAtual === 'folgas') carregarFolgas();
            if (abaAtual === 'relatorio') carregarRelatorio();
        } catch (error) {
            if (error.message === 'sessao_expirada') return;
            $('atualizado-txt').textContent = 'Sem conexão';
            if (!silencioso) Tema.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível carregar os dados agora.' });
        } finally { icone.classList.remove('fa-spin'); }
    }

    function desenharTudo() {
        filtrarTabela();
        calcularResumo();
        desenharProximo();
    }

    // --- próximo cliente ---
    function desenharProximo() {
        const box = $('proximo-cliente');
        const agora = Date.now();
        const lista = todosAgendamentos
            .map(a => ({ a, t: RodUtil.instante(a.data, a.hora).getTime() }))
            .filter(x => x.t + (RodUtil.duracoes[x.a.servico] || 40) * 60000 >= agora)
            .sort((x, y) => x.t - y.t);
        if (!lista.length) { box.hidden = true; return; }
        const { a } = lista[0];
        const pago = a.statusPagamento === 'approved';
        const hoje = hojeSP();
        const restantesHoje = lista.filter(x => x.a.data === hoje).length;
        box.hidden = false;
        box.innerHTML = `
            <span class="pc-selo"><i class="fas fa-bolt"></i> Próximo cliente</span>
            <div class="pc-corpo">
                <strong>${esc(a.nome)}</strong>
                <span>${esc(a.servico)} · ${esc(RodUtil.quando(a.data, a.hora))}</span>
            </div>
            <span class="badge ${pago ? 'bg-pago' : 'bg-pendente'}">${pago ? 'Pago' : 'Pendente'}</span>
            ${restantesHoje > 1 ? `<span class="pc-extra">${restantesHoje - 1} outro${restantesHoje - 1 === 1 ? '' : 's'} hoje</span>` : ''}`;
    }

    function badgeStatus(ag) {
        if (ag.statusPagamento === 'approved') {
            const manual = ag.pagamentoManual ? ` · ${esc(FORMAS[ag.pagamentoManual] || '')}` : '';
            return `<span class="badge bg-pago"><i class="fas fa-check"></i> PAGO${manual}</span>`;
        }
        return '<span class="badge bg-pendente"><i class="fas fa-clock"></i> PENDENTE</span>';
    }

    function renderizarTabela(lista) {
        const tbody = $('lista-admin');
        tbody.innerHTML = '';

        if (lista.length === 0) {
            tbody.innerHTML = '<tr class="linha-vazia"><td colspan="6" style="text-align:center; padding:40px; color:var(--text-faint); display:table-cell;"><i class="fas fa-box-open" style="font-size:2em; margin-bottom:10px;"></i><br>Nenhum agendamento encontrado neste filtro.</td></tr>';
            return;
        }

        const hoje = hojeSP();
        lista.forEach(ag => {
            const pago = ag.statusPagamento === 'approved';
            const tr = document.createElement('tr');
            if (ag.data === hoje) tr.classList.add('hoje');
            tr.innerHTML = `
                <td data-label="Data / Hora">
                    <span class="info-principal info-destaque">${formatarData(ag.data)}${ag.data === hoje ? ' <em class="tag-hoje">hoje</em>' : ''}</span>
                    <span class="info-secundaria"><i class="far fa-clock"></i> ${esc(ag.hora)} · ${esc(RodUtil.diaDaSemana(ag.data, 'short'))}</span>
                </td>
                <td data-label="Cliente">
                    <span class="info-principal">${esc(ag.nome)}${ag.origem === 'painel' ? ' <em class="tag-origem" title="Agendado por você no painel">painel</em>' : ''}</span>
                    ${ag.email ? `<span class="info-secundaria"><a class="link-email" href="mailto:${esc(ag.email)}">${esc(ag.email)}</a></span>` : ''}
                    ${ag.telefone ? `<span class="info-secundaria"><a class="link-whats" href="https://wa.me/55${esc(ag.telefone)}?text=${encodeURIComponent('Olá, ' + String(ag.nome).split(' ')[0] + '! Aqui é o Rod, sobre seu horário de ' + formatarData(ag.data) + ' às ' + ag.hora + '.')}" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> ${esc(telBR(ag.telefone))}</a></span>` : ''}
                </td>
                <td data-label="Serviço">${esc(ag.servico)}</td>
                <td data-label="Valor" style="font-weight:bold; color: #2ecc71;">${brl(ag.valor)}</td>
                <td data-label="Status">${badgeStatus(ag)}</td>
                <td data-label="Ações" style="text-align: center;">
                    <div class="acoes-linha">
                        ${ag.data >= hoje ? `<button type="button" class="btn-lixeira" data-acao="remarcar" data-id="${esc(ag._id)}" title="Remarcar" aria-label="Remarcar agendamento"><i class="fas fa-calendar-days"></i></button>` : ''}
                        ${pago ? '' : `<button type="button" class="btn-recebi" data-acao="pago" data-id="${esc(ag._id)}" title="Recebi o pagamento em mãos"><i class="fas fa-hand-holding-dollar"></i> Recebi</button>`}
                        <button type="button" class="btn-lixeira" data-acao="excluir" data-id="${esc(ag._id)}" title="Excluir" aria-label="Excluir agendamento"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderizarBalcao(lista) {
        const tbody = $('lista-balcao');
        tbody.innerHTML = '';

        if (lista.length === 0) {
            tbody.innerHTML = '<tr class="linha-vazia"><td colspan="6" style="text-align:center; padding:40px; color:var(--text-faint); display:table-cell;"><i class="fas fa-store" style="font-size:2em; margin-bottom:10px;"></i><br>Nenhum atendimento de balcão encontrado.<br><span style="font-size:.85em;">Use "Registrar atendimento" para lançar um corte feito na barbearia.</span></td></tr>';
            return;
        }

        lista.forEach(at => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Data / Hora">
                    <span class="info-principal info-destaque">${formatarData(at.data)}</span>
                    <span class="info-secundaria"><i class="far fa-clock"></i> ${esc(at.hora)}</span>
                </td>
                <td data-label="Cliente">
                    <span class="info-principal">${esc(at.nome) || 'Não informado'}</span>
                    ${at.observacao ? `<span class="info-secundaria">${esc(at.observacao)}</span>` : ''}
                </td>
                <td data-label="Serviço">${esc(at.servico)}</td>
                <td data-label="Pagamento"><span class="badge bg-forma">${esc(FORMAS[at.forma] || 'Outro')}</span></td>
                <td data-label="Valor" style="font-weight:bold; color: #2ecc71;">${brl(at.valor)}</td>
                <td data-label="Ação" style="text-align: center;">
                    <div class="acoes-linha"><button type="button" class="btn-lixeira" data-acao="excluir-atendimento" data-id="${esc(at._id)}" title="Excluir" aria-label="Excluir atendimento"><i class="fas fa-trash-alt"></i></button></div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // caixa = agendamentos pagos pelo site + atendimentos de balcão
    function calcularResumo() {
        const hoje = hojeSP(), mes = hoje.slice(0, 7);
        const pagos = todosAgendamentos.filter(a => a.statusPagamento === 'approved');
        const soma = lista => lista.reduce((s, x) => s + (Number(x.valor) || 0), 0);
        const doDia = l => l.filter(x => x.data === hoje), doMes = l => l.filter(x => String(x.data).startsWith(mes));

        $('total-hoje').innerText = todosAgendamentos.filter(a => a.data === hoje).length;
        $('caixa-hoje').innerText = brl(soma(doDia(pagos)) + soma(doDia(todosAtendimentos)));
        $('fat-mes').innerText = brl(soma(doMes(pagos)) + soma(doMes(todosAtendimentos)));
        $('atend-mes').innerText = doMes(pagos).length + doMes(todosAtendimentos).length;

        const pend = todosAgendamentos.filter(a => a.statusPagamento !== 'approved' && a.data >= hoje).length;
        for (const id of ['n-pendentes', 'n-pend-aba']) { $(id).hidden = !pend; $(id).textContent = pend; }
    }

    // --- filtros da lista ---
    function aplicarChip(lista) {
        const hoje = hojeSP(), amanha = RodUtil.hojeSP(1);
        const asc = (a, b) => chave(a) < chave(b) ? -1 : 1, desc = (a, b) => -asc(a, b);
        switch (filtroChip) {
            case 'hoje': return lista.filter(a => a.data === hoje).sort(asc);
            case 'amanha': return lista.filter(a => a.data === amanha).sort(asc);
            case 'pendentes': return lista.filter(a => a.statusPagamento !== 'approved').sort(asc);
            case 'passados': return lista.filter(a => a.data < hoje).sort(desc);
            case 'todos': return lista.slice().sort(desc);
            default: return lista.filter(a => a.data >= hoje).sort(asc);
        }
    }

    function filtrarTabela() {
        const dataFiltro = $('filtro-data').value;
        const termo = $('busca').value.trim().toLowerCase();
        const porTermo = (lista, campos) => termo ? lista.filter(x => campos.some(c => String(x[c] || '').toLowerCase().includes(termo))) : lista;

        let ags = todosAgendamentos;
        ags = dataFiltro ? ags.filter(a => a.data === dataFiltro).sort((a, b) => chave(a) < chave(b) ? -1 : 1) : aplicarChip(ags);
        renderizarTabela(porTermo(ags, ['nome', 'email', 'servico']));

        let ats = dataFiltro ? todosAtendimentos.filter(a => a.data === dataFiltro) : todosAtendimentos;
        renderizarBalcao(porTermo(ats, ['nome', 'servico', 'observacao']));

        document.querySelectorAll('#chips .chip').forEach(c => c.classList.toggle('ativo', !dataFiltro && c.dataset.f === filtroChip));
        $('btn-limpar-data').hidden = !dataFiltro;
    }

    window.aoMudarData = filtrarTabela;
    window.limparData = () => { $('filtro-data').value = ''; filtrarTabela(); };
    window.carregarDados = carregarDados;
    window.filtrarTabela = filtrarTabela;

    $('chips').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        filtroChip = b.dataset.f; $('filtro-data').value = ''; filtrarTabela();
    });
    let esperaBusca = null;
    $('busca').addEventListener('input', () => { clearTimeout(esperaBusca); esperaBusca = setTimeout(filtrarTabela, 150); });

    window.mudarAba = function (nome) {
        abaAtual = nome;
        ['agendamentos', 'balcao', 'folgas', 'servicos', 'avaliacoes', 'relatorio'].forEach(a => {
            $('aba-' + a).hidden = a !== nome;
            $('btn-aba-' + a).classList.toggle('ativa', a === nome);
        });
        const semFiltros = ['relatorio', 'folgas', 'servicos', 'avaliacoes'].includes(nome);
        $('filtro-wrap').style.display = semFiltros ? 'none' : '';
        $('filtros-lista').style.display = semFiltros ? 'none' : '';
        document.querySelector('.chips').style.display = nome === 'agendamentos' ? '' : 'none';
        if (nome === 'relatorio') carregarRelatorio();
        if (nome === 'folgas') carregarFolgas();
        if (nome === 'servicos') carregarServicosAdmin();
        if (nome === 'avaliacoes') carregarAvaliacoesAdmin();
    };

    // --- ações nas linhas (excluir / marcar como pago) ---
    async function confirmarExclusao(titulo, texto) {
        const r = await Tema.fire({
            title: titulo, text: texto, icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#cf4a40', confirmButtonText: 'Sim, excluir', cancelButtonText: 'Cancelar'
        });
        return r.isConfirmed;
    }

    async function deletarAgendamento(id) {
        const ag = todosAgendamentos.find(a => a._id === id);
        const pago = ag && ag.statusPagamento === 'approved';
        if (!(await confirmarExclusao('Excluir agendamento?', pago ? 'ATENÇÃO: este horário já foi pago. Excluir não devolve o dinheiro automaticamente.' : 'O horário volta a ficar livre e o PIX é cancelado.'))) return;
        try {
            const res = await RodAuth.fetch(`${API_URL}/agendamentos/${id}`, { method: 'DELETE' });
            const corpo = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(corpo.mensagem || 'falha');
            toast('success', 'Excluído!');
            carregarDados(true);
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não foi possível excluir', text: error.message === 'falha' ? 'Tente novamente.' : error.message }); carregarDados(true); }
    }

    async function marcarComoPago(id) {
        const ag = todosAgendamentos.find(a => a._id === id); if (!ag) return;
        const r = await Tema.fire({
            title: 'Recebi o pagamento', icon: 'question',
            html: `<b>${esc(ag.nome)}</b> · ${esc(ag.servico)}<br>${formatarData(ag.data)} às ${esc(ag.hora)} · <b>${brl(ag.valor)}</b><br><small style="color:#b2a996">Como o cliente pagou?</small>`,
            input: 'radio', inputValue: 'dinheiro', inputOptions: { dinheiro: 'Dinheiro', pix: 'PIX direto', debito: 'Cartão de débito', credito: 'Cartão de crédito' },
            showCancelButton: true, confirmButtonText: 'Confirmar pagamento', cancelButtonText: 'Voltar'
        });
        if (!r.isConfirmed || !r.value) return;
        try {
            const res = await RodAuth.fetch(`${API_URL}/agendamentos/${id}/pago`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forma: r.value }) });
            const corpo = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(corpo.mensagem || 'falha');
            toast('success', 'Pagamento registrado!');
            carregarDados(true);
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não foi possível registrar', text: error.message === 'falha' ? 'Tente novamente.' : error.message }); }
    }

    async function deletarAtendimento(id) {
        if (!(await confirmarExclusao('Excluir atendimento?', 'O valor sai do caixa e do relatório.'))) return;
        try {
            const res = await RodAuth.fetch(`${API_URL}/atendimentos/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('falha');
            toast('success', 'Excluído!');
            carregarDados(true);
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Falha ao excluir' }); }
    }

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-acao]'); if (!b) return;
        const id = b.dataset.id;
        if (b.dataset.acao === 'excluir') deletarAgendamento(id);
        else if (b.dataset.acao === 'pago') marcarComoPago(id);
        else if (b.dataset.acao === 'excluir-atendimento') deletarAtendimento(id);
        else if (b.dataset.acao === 'remover-folga') removerFolga(id);
        else if (b.dataset.acao === 'salvar-servico') salvarServico(id);
        else if (b.dataset.acao === 'remarcar') remarcarAgendamento(id);
        else if (b.dataset.acao === 'ocultar-avaliacao') alternarAvaliacao(id, true);
        else if (b.dataset.acao === 'mostrar-avaliacao') alternarAvaliacao(id, false);
    });

    // --- novo agendamento (cliente pediu pelo WhatsApp, telefone ou pessoalmente) ---
    window.novoAgendamento = function () {
        const opcoes = Object.keys(PRECOS).map(nm => `<option value="${esc(nm)}">${esc(nm)} - ${brl(PRECOS[nm])}</option>`).join('');
        RodSeletor.abrir({
            api: API_URL, titulo: 'Novo agendamento', textoBotao: 'Agendar',
            subtitulo: 'Para clientes que pediram pelo WhatsApp ou pessoalmente. Fica como pendente até você marcar "Recebi".',
            extraHtml: '<div class="sel-campos"><label class="sel-rotulo" for="na-nome">Cliente</label><input id="na-nome" class="sel-input" maxlength="80" placeholder="Nome do cliente" autocomplete="off">' +
                '<label class="sel-rotulo" for="na-tel">WhatsApp (opcional)</label><input id="na-tel" class="sel-input" type="tel" inputmode="tel" maxlength="16" placeholder="(11) 91234-5678">' +
                '<label class="sel-rotulo" for="na-serv">Serviço</label><select id="na-serv" class="sel-input">' + opcoes + '</select></div>',
            coletarExtra: ov => {
                const nome = ov.querySelector('#na-nome').value.trim(), tel = ov.querySelector('#na-tel').value.replace(/\D/g, '');
                if (nome.length < 2) return 'Informe o nome do cliente.';
                if (tel && tel.length !== 10 && tel.length !== 11) return 'WhatsApp incompleto: use DDD + número.';
                return { nome, telefone: tel, servico: ov.querySelector('#na-serv').value };
            },
            aoConfirmar: async sel => {
                const res = await RodAuth.fetch(`${API_URL}/agendamentos/manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sel.extra, data: sel.data, hora: sel.hora }) });
                const d = await res.json().catch(() => ({}));
                if (!res.ok) return d.mensagem || 'Não foi possível agendar.';
                toast('success', `Agendado: ${sel.extra.nome} · ${formatarData(sel.data)} ${sel.hora}`);
                window.mudarAba('agendamentos');
                carregarDados(true);
                return null;
            }
        });
        const t = document.getElementById('na-tel');
        if (t) t.addEventListener('input', () => {
            const d = t.value.replace(/\D/g, '').slice(0, 11);
            t.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
        });
    };

    function remarcarAgendamento(id) {
        const ag = todosAgendamentos.find(a => a._id === id); if (!ag) return;
        RodSeletor.abrir({
            api: API_URL, titulo: 'Remarcar', textoBotao: 'Confirmar nova data', dataInicial: ag.data >= hojeSP() ? ag.data : '',
            subtitulo: `<b>${esc(ag.nome)}</b> · ${esc(ag.servico)}<br>Marcado para ${formatarData(ag.data)} às ${esc(ag.hora)}${ag.email ? '<br><small>O cliente recebe um e-mail com a nova data.</small>' : ''}`,
            aoConfirmar: async sel => {
                const res = await RodAuth.fetch(`${API_URL}/agendamentos/${id}/remarcar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: sel.data, hora: sel.hora }) });
                const d = await res.json().catch(() => ({}));
                if (!res.ok) return d.mensagem || 'Não foi possível remarcar.';
                toast('success', `Remarcado para ${formatarData(sel.data)} às ${sel.hora}`);
                carregarDados(true);
                return null;
            }
        });
    }

    // --- avaliações ---
    const estrelas = nv => '<span class="av-estrelas" aria-label="' + nv + ' de 5">' + '★'.repeat(nv) + '<span>' + '★'.repeat(5 - nv) + '</span></span>';
    async function carregarAvaliacoesAdmin() {
        const alvo = $('avaliacoes-admin');
        alvo.innerHTML = '<p class="rel-vazio"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';
        try {
            const res = await RodAuth.fetch(`${API_URL}/avaliacoes/todas`);
            if (!res.ok) throw new Error('falha');
            const lista = await res.json();
            if (!lista.length) { alvo.innerHTML = '<p class="rel-vazio"><i class="far fa-star"></i> Ainda não há avaliações. Elas chegam por e-mail depois dos atendimentos pagos.</p>'; return; }
            const media = lista.reduce((s, a) => s + a.nota, 0) / lista.length;
            const dist = [5, 4, 3, 2, 1].map(nv => ({ nv, q: lista.filter(a => a.nota === nv).length }));
            alvo.innerHTML = `
                <div class="av-resumo">
                    <div class="av-media"><strong>${media.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>${estrelas(Math.round(media))}<span>${lista.length} avaliaç${lista.length === 1 ? 'ão' : 'ões'}</span></div>
                    <div class="av-dist">${dist.map(x => `<div class="av-dist-linha"><span>${x.nv}★</span><span class="rel-barra"><span style="width:${Math.round(x.q / lista.length * 100)}%"></span></span><small>${x.q}</small></div>`).join('')}</div>
                </div>
                <div class="av-lista">${lista.map(a => `
                    <div class="av-item${a.oculta ? ' oculta' : ''}${a.nota <= 3 ? ' baixa' : ''}">
                        <div class="av-topo">${estrelas(a.nota)}<strong>${esc(a.nome)}</strong><span>${esc(a.servico)} · ${new Date(a.createdAt).toLocaleDateString('pt-BR')}</span>${a.oculta ? '<span class="badge bg-forma">Oculta no site</span>' : ''}</div>
                        ${a.comentario ? `<p>"${esc(a.comentario)}"</p>` : '<p class="av-sem">Sem comentário.</p>'}
                        <button type="button" class="btn-sec-admin" data-acao="${a.oculta ? 'mostrar' : 'ocultar'}-avaliacao" data-id="${esc(a._id)}"><i class="far fa-eye${a.oculta ? '' : '-slash'}"></i> ${a.oculta ? 'Mostrar no site' : 'Ocultar do site'}</button>
                    </div>`).join('')}</div>`;
        } catch (error) { if (error.message !== 'sessao_expirada') alvo.innerHTML = '<p class="rel-vazio">Não foi possível carregar as avaliações.</p>'; }
    }

    async function alternarAvaliacao(id, oculta) {
        try {
            const res = await RodAuth.fetch(`${API_URL}/avaliacoes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oculta }) });
            if (!res.ok) throw new Error('falha');
            toast('success', oculta ? 'Avaliação ocultada do site.' : 'Avaliação visível no site.');
            carregarAvaliacoesAdmin();
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não foi possível alterar' }); }
    }

    // --- serviços e preços ---
    let servicosAdmin = [];

    function aplicarServicosNaPagina(lista) {
        const ativos = lista.filter(s => s.ativo !== false);
        if (ativos.length) PRECOS = Object.fromEntries(ativos.map(s => [s.nome, Number(s.preco)]));
        lista.forEach(s => { RodUtil.duracoes[s.nome] = Number(s.minutos) || 40; });
    }

    async function carregarServicosPublicos() {
        try { const r = await fetch(`${API_URL}/servicos`); if (r.ok) aplicarServicosNaPagina(await r.json()); } catch (e) { /* ficam os padrões */ }
    }

    function opcoesIcone(atual) {
        return Object.entries(ICONES).map(([v, nome]) => `<option value="${v}"${v === atual ? ' selected' : ''}>${nome}</option>`).join('');
    }

    function renderServicosAdmin() {
        const alvo = $('lista-servicos-admin');
        alvo.innerHTML = servicosAdmin.map(s => `
            <div class="srv-item${s.ativo ? '' : ' inativo'}" data-id="${esc(s._id)}">
                <span class="srv-icone"><i class="fas ${esc(s.icone)}"></i></span>
                <div class="srv-nome"><strong>${esc(s.nome)}</strong>${s.ativo ? '' : '<span class="badge bg-forma">Desativado</span>'}</div>
                <label class="srv-campo"><span>Preço (R$)</span><input type="number" class="srv-preco" min="0.5" max="5000" step="0.5" inputmode="decimal" value="${Number(s.preco)}"></label>
                <label class="srv-campo"><span>Duração (min)</span><input type="number" class="srv-min" min="5" max="480" step="5" inputmode="numeric" value="${Number(s.minutos)}"></label>
                <label class="srv-campo"><span>Ícone</span><select class="srv-icone-sel">${opcoesIcone(s.icone)}</select></label>
                <label class="srv-switch" title="Aparece no site"><input type="checkbox" class="srv-ativo"${s.ativo ? ' checked' : ''}><span class="srv-trilho"></span><em>${s.ativo ? 'Ativo' : 'Inativo'}</em></label>
                <button type="button" class="btn-salvar-srv" data-acao="salvar-servico" data-id="${esc(s._id)}" disabled><i class="fas fa-check"></i> Salvar</button>
            </div>`).join('') || '<p class="rel-vazio">Nenhum serviço cadastrado.</p>';
    }

    async function carregarServicosAdmin() {
        $('sv-icone').innerHTML = opcoesIcone('fa-scissors');
        try {
            const res = await RodAuth.fetch(`${API_URL}/servicos/todos`);
            if (!res.ok) throw new Error('falha');
            servicosAdmin = await res.json();
            aplicarServicosNaPagina(servicosAdmin);
            renderServicosAdmin();
        } catch (error) { if (error.message !== 'sessao_expirada') $('lista-servicos-admin').innerHTML = '<p class="rel-vazio">Não foi possível carregar os serviços.</p>'; }
    }

    // habilita "Salvar" na linha assim que algo muda
    function marcarSujo(ev) {
        const linha = ev.target.closest('.srv-item'); if (!linha) return;
        linha.querySelector('.btn-salvar-srv').disabled = false;
        if (ev.target.classList.contains('srv-ativo')) linha.querySelector('.srv-switch em').textContent = ev.target.checked ? 'Ativo' : 'Inativo';
    }
    document.addEventListener('input', marcarSujo);
    document.addEventListener('change', marcarSujo);

    async function salvarServico(id) {
        const linha = document.querySelector(`.srv-item[data-id="${id}"]`); if (!linha) return;
        const btn = linha.querySelector('.btn-salvar-srv');
        const corpo = { preco: linha.querySelector('.srv-preco').value, minutos: linha.querySelector('.srv-min').value, icone: linha.querySelector('.srv-icone-sel').value, ativo: linha.querySelector('.srv-ativo').checked };
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            const res = await RodAuth.fetch(`${API_URL}/servicos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
            const dados = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(dados.erro || 'Não foi possível salvar.');
            toast('success', 'Serviço atualizado!');
            await carregarServicosAdmin();
        } catch (error) {
            if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não salvou', text: error.message });
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Salvar';
        }
    }

    window.criarServico = async function (ev) {
        ev.preventDefault();
        const btn = $('btn-criar-servico');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adicionando...';
        try {
            const res = await RodAuth.fetch(`${API_URL}/servicos`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome: $('sv-nome').value.trim(), preco: $('sv-preco').value, minutos: $('sv-min').value, icone: $('sv-icone').value })
            });
            const dados = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(dados.erro || 'Não foi possível adicionar.');
            $('form-servico').reset(); $('sv-min').value = 30;
            toast('success', 'Serviço adicionado!');
            await carregarServicosAdmin();
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não adicionou', text: error.message }); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Adicionar'; }
    };

    // --- folgas e horários bloqueados ---
    function horariosDoDia() {
        const lista = [];
        [[9 * 60, 11 * 60 + 30], [13 * 60, 21 * 60 + 30]].forEach(([ini, fim]) => {
            for (let t = ini; t <= fim; t += 35) lista.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
        });
        return lista;
    }

    function prepararFormFolga() {
        const d = $('fg-data'); d.min = hojeSP(); if (!d.value) d.value = hojeSP();
        $('fg-hora').innerHTML = '<option value="">Dia inteiro</option>' + horariosDoDia().map(h => `<option value="${h}">${h}</option>`).join('');
    }

    async function carregarFolgas() {
        prepararFormFolga();
        const alvo = $('lista-folgas');
        try {
            const res = await RodAuth.fetch(`${API_URL}/bloqueios`);
            if (!res.ok) throw new Error('falha');
            folgas = await res.json();
            if (!folgas.length) { alvo.innerHTML = '<p class="rel-vazio"><i class="fas fa-umbrella-beach"></i> Nenhum bloqueio. A agenda está toda aberta.</p>'; return; }
            alvo.innerHTML = folgas.map(f => `
                <div class="folga-item">
                    <div class="folga-data"><strong>${formatarData(f.data)}</strong><span>${esc(RodUtil.diaDaSemana(f.data, 'long'))}</span></div>
                    <div class="folga-info"><span class="badge ${f.hora ? 'bg-forma' : 'bg-pendente'}">${f.hora ? esc(f.hora) : 'Dia inteiro'}</span>${f.motivo ? `<span class="folga-motivo">${esc(f.motivo)}</span>` : ''}</div>
                    <button type="button" class="btn-lixeira" data-acao="remover-folga" data-id="${esc(f._id)}" title="Liberar" aria-label="Remover bloqueio"><i class="fas fa-lock-open"></i></button>
                </div>`).join('');
        } catch (error) { if (error.message !== 'sessao_expirada') alvo.innerHTML = '<p class="rel-vazio">Não foi possível carregar os bloqueios.</p>'; }
    }

    window.salvarFolga = async function (ev) {
        ev.preventDefault();
        const btn = $('btn-salvar-folga');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bloqueando...';
        try {
            const res = await RodAuth.fetch(`${API_URL}/bloqueios`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: $('fg-data').value, hora: $('fg-hora').value, motivo: $('fg-motivo').value.trim() })
            });
            const dados = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(dados.erro || 'Não foi possível bloquear.');
            $('fg-motivo').value = '';
            if (dados.agendamentosNoDia) Tema.fire({ icon: 'info', title: 'Dia bloqueado', text: `Atenção: já existem ${dados.agendamentosNoDia} agendamento(s) nesse dia. Eles continuam valendo; só novos agendamentos foram bloqueados.` });
            else toast('success', 'Bloqueado!');
            carregarFolgas();
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não bloqueou', text: error.message }); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-ban"></i> Bloquear'; }
    };

    async function removerFolga(id) {
        try {
            const res = await RodAuth.fetch(`${API_URL}/bloqueios/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('falha');
            toast('success', 'Liberado!');
            carregarFolgas();
        } catch (error) { if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Falha ao liberar' }); }
    }

    // --- registrar atendimento avulso ---
    function montarServicos() {
        const sel = $('at-servico');
        sel.innerHTML = Object.keys(PRECOS).map(n => `<option value="${esc(n)}">${esc(n)} - ${brl(PRECOS[n])}</option>`).join('') +
            '<option value="__outro">Outro serviço...</option>';
    }

    window.aoMudarServico = function () {
        const sel = $('at-servico'), outro = $('at-servico-outro');
        const ehOutro = sel.value === '__outro';
        outro.style.display = ehOutro ? '' : 'none';
        outro.required = ehOutro;
        if (!ehOutro) $('at-valor').value = PRECOS[sel.value];
        else { $('at-valor').value = ''; outro.focus(); }
    };

    window.abrirModalAtendimento = function () {
        $('form-atendimento').reset();
        montarServicos();
        const hoje = hojeSP();
        const data = $('at-data');
        data.max = hoje; data.value = hoje;
        $('at-hora').value = horaSP();
        $('at-servico-outro').style.display = 'none';
        $('at-servico-outro').required = false;
        $('at-valor').value = PRECOS[$('at-servico').value];
        $('modal-atendimento').style.display = 'flex';
        $('at-valor').focus();
    };

    window.fecharModalAtendimento = function () { $('modal-atendimento').style.display = 'none'; };
    window.fecharModalAtendimentoFundo = function (arg, ev, el) { if (ev.target === el) window.fecharModalAtendimento(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.fecharModalAtendimento(); });

    window.salvarAtendimento = async function (evento) {
        evento.preventDefault();
        const sel = $('at-servico').value;
        const corpo = {
            servico: sel === '__outro' ? $('at-servico-outro').value.trim() : sel,
            valor: $('at-valor').value,
            forma: document.querySelector('input[name="forma"]:checked').value,
            nome: $('at-nome').value.trim(),
            data: $('at-data').value,
            hora: $('at-hora').value,
            observacao: $('at-obs').value.trim()
        };
        const btn = $('btn-salvar-atendimento');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        try {
            const res = await RodAuth.fetch(`${API_URL}/atendimentos`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
            });
            const dados = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(dados.erro || 'Não foi possível salvar.');
            window.fecharModalAtendimento();
            toast('success', 'Atendimento registrado!');
            window.mudarAba('balcao');
            await carregarDados(true);
        } catch (error) {
            if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não salvou', text: error.message });
        } finally {
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Salvar atendimento';
        }
    };

    // --- relatório do mês ---
    function barra(valor, maximo) {
        const pct = maximo > 0 ? Math.max(4, Math.round(valor / maximo * 100)) : 0;
        return `<span class="rel-barra"><span style="width:${pct}%"></span></span>`;
    }

    function listaRelatorio(titulo, icone, itens) {
        const max = Math.max(0, ...itens.map(i => i.total));
        const linhas = itens.length ? itens.map(i => `
            <div class="rel-linha">
                <div class="rel-linha-topo"><span>${esc(i.nome)}</span><strong>${brl(i.total)}</strong></div>
                ${barra(i.total, max)}
                <small>${i.qtd} atendimento${i.qtd === 1 ? '' : 's'}</small>
            </div>`).join('') : '<p class="rel-vazio">Sem movimento neste mês.</p>';
        return `<div class="rel-bloco"><h2><i class="${icone}"></i> ${titulo}</h2>${linhas}</div>`;
    }

    window.carregarRelatorio = async function () {
        const campo = $('rel-mes');
        if (!campo.value) campo.value = hojeSP().slice(0, 7);
        const alvo = $('rel-conteudo');
        alvo.innerHTML = '<p class="rel-vazio"><i class="fas fa-spinner fa-spin"></i> Calculando...</p>';
        try {
            const res = await RodAuth.fetch(`${API_URL}/relatorio?mes=${encodeURIComponent(campo.value)}`);
            const r = await res.json();
            if (!res.ok) throw new Error(r.erro || 'falha');

            const v = r.variacaoPercentual;
            const comparacao = v === null ? '<span class="rel-neutro">sem mês anterior para comparar</span>'
                : `<span class="${v >= 0 ? 'rel-alta' : 'rel-baixa'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toLocaleString('pt-BR')}% vs mês anterior (${brl(r.totalMesAnterior)})</span>`;
            const totalSplit = r.totalOnline + r.totalBalcao;
            const pctOnline = totalSplit > 0 ? Math.round(r.totalOnline / totalSplit * 100) : 0;

            alvo.innerHTML = `
                <div class="rel-kpis">
                    <div class="rel-kpi destaque"><span>Faturamento de ${esc(r.nomeMes)}</span><strong>${brl(r.total)}</strong>${comparacao}</div>
                    <div class="rel-kpi"><span>Atendimentos</span><strong>${r.atendimentos}</strong><small>${r.atendimentosOnline} site · ${r.atendimentosBalcao} balcão</small></div>
                    <div class="rel-kpi"><span>Ticket médio</span><strong>${brl(r.ticketMedio)}</strong><small>${r.diasComMovimento} dia${r.diasComMovimento === 1 ? '' : 's'} com movimento</small></div>
                    <div class="rel-kpi"><span>Melhor dia</span><strong>${r.melhorDia ? formatarData(r.melhorDia.data) : '--'}</strong><small>${r.melhorDia ? brl(r.melhorDia.total) : 'sem movimento'}</small></div>
                </div>
                <div class="rel-split">
                    <div class="rel-split-barra"><span style="width:${pctOnline}%"></span></div>
                    <div class="rel-split-legenda"><span><i class="fas fa-globe"></i> Site ${brl(r.totalOnline)}</span><span><i class="fas fa-store"></i> Balcão ${brl(r.totalBalcao)}</span></div>
                </div>
                <div class="rel-grade">
                    ${listaRelatorio('Por serviço', 'fas fa-scissors', r.porServico)}
                    ${listaRelatorio('Forma de pagamento', 'fas fa-wallet', r.porForma)}
                    ${listaRelatorio('Clientes que mais vieram', 'fas fa-user-group', r.topClientes || [])}
                    ${listaRelatorio('Horários mais movimentados', 'far fa-clock', r.porHorario || [])}
                    ${listaRelatorio('Dias da semana', 'far fa-calendar', (r.porDiaSemana || []).filter(d => d.qtd))}
                </div>
                ${r.aguardandoPagamento.qtd ? `<p class="rel-aviso"><i class="fas fa-triangle-exclamation"></i> ${r.aguardandoPagamento.qtd} reserva${r.aguardandoPagamento.qtd === 1 ? '' : 's'} sem pagamento (${brl(r.aguardandoPagamento.total)}) não entram no faturamento.</p>` : ''}
            `;
        } catch (error) {
            alvo.innerHTML = `<p class="rel-vazio">Não foi possível carregar o relatório. ${esc(error.message === 'sessao_expirada' ? '' : error.message)}</p>`;
        }
    };

    window.enviarRelatorio = async function () {
        const mes = $('rel-mes').value || hojeSP().slice(0, 7);
        const btn = $('btn-enviar-relatorio');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        try {
            const res = await RodAuth.fetch(`${API_URL}/relatorio/enviar`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes })
            });
            const dados = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(dados.erro || 'falha');
            Tema.fire({ icon: 'success', title: 'Relatório enviado!', text: dados.mensagem });
        } catch (error) {
            if (error.message !== 'sessao_expirada') Tema.fire({ icon: 'error', title: 'Não enviou', text: error.message });
        } finally {
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-envelope"></i> Enviar por e-mail';
        }
    };

    // planilha (CSV com ; e BOM: abre direto no Excel em português)
    function celula(v) {
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // evita fórmulas vindas de nomes digitados por clientes
        return '"' + s.replace(/"/g, '""') + '"';
    }

    window.exportarCsv = function () {
        const mes = $('rel-mes').value || hojeSP().slice(0, 7);
        const linhas = [['Data', 'Hora', 'Origem', 'Cliente', 'Serviço', 'Pagamento', 'Valor (R$)']];
        todosAgendamentos.filter(a => a.statusPagamento === 'approved' && a.data.startsWith(mes))
            .forEach(a => linhas.push([formatarData(a.data), a.hora, 'Site', a.nome, a.servico, a.pagamentoManual ? FORMAS[a.pagamentoManual] : 'Online (PIX/cartão)', Number(a.valor).toFixed(2).replace('.', ',')]));
        todosAtendimentos.filter(a => a.data.startsWith(mes))
            .forEach(a => linhas.push([formatarData(a.data), a.hora, 'Balcão', a.nome || '', a.servico, FORMAS[a.forma] || 'Outro', Number(a.valor).toFixed(2).replace('.', ',')]));
        if (linhas.length === 1) { toast('info', 'Sem movimento neste mês.'); return; }
        const dados = linhas.slice(1).sort((a, b) => (a[0].split('/').reverse().join('') + a[1]) < (b[0].split('/').reverse().join('') + b[1]) ? -1 : 1);
        const csv = '﻿' + [linhas[0]].concat(dados).map(l => l.map(celula).join(';')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `rodbarber-${mes}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('success', 'Planilha baixada!');
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('rel-mes').value = hojeSP().slice(0, 7);
        carregarServicosPublicos();
        carregarDados();
        // atualização automática (a cada minuto e ao voltar para a aba)
        setInterval(() => { if (!document.hidden) carregarDados(true); }, 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) carregarDados(true); });
    });
})();

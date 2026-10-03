(function () {
    'use strict';
    var API_URL = 'https://rodbarber-api-0jna.onrender.com';
    var esc = RodAuth.esc;
    var intervaloVerificacao = null;
    var lista = [];
    var Tema = Swal.mixin({ background: '#151310', color: '#f4efe4', confirmButtonColor: '#c7a04a', cancelButtonColor: '#2b2822' });
    var Toast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 2200, background: '#1c1a16', color: '#f4efe4' });
    var $ = function (id) { return document.getElementById(id); };

    function fim(ag) { return RodUtil.instante(ag.data, ag.hora).getTime() + (RodUtil.duracoes[ag.servico] || 40) * 60000; }
    function jaTerminou(ag) { return fim(ag) < Date.now(); }
    function limiteId(id) { return String(id || '').replace(/[^a-f0-9]/gi, ''); }

    function esqueleto() { return '<div class="skel-card skel"></div><div class="skel-card skel"></div>'; }

    function vazio() {
        return '<div class="estado-vazio"><i class="far fa-calendar-plus"></i>' +
            '<h3>Você ainda não tem cortes marcados</h3><p>Escolha serviço, dia e horário em menos de 1 minuto.</p>' +
            '<a href="/#agendamento" class="btn-novo grande"><i class="far fa-calendar-plus"></i> Agendar agora</a></div>';
    }

    function erroCarregar() {
        return '<div class="estado-vazio"><i class="fas fa-triangle-exclamation"></i><h3>Não foi possível carregar</h3>' +
            '<p>O servidor pode estar acordando. Tente de novo em alguns segundos.</p>' +
            '<button type="button" class="btn-novo grande" id="btn-recarregar"><i class="fas fa-rotate-right"></i> Tentar de novo</button></div>';
    }

    function cartao(ag, destaque) {
        var pago = ag.statusPagamento === 'approved';
        var passou = jaTerminou(ag);
        var d = new Date(ag.data + 'T12:00:00');
        var mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        var rotulo, classe;
        if (pago) { rotulo = passou ? 'Concluído' : 'Pago'; classe = 'status-pago'; }
        else { rotulo = passou ? 'Não pago' : 'Aguardando pagamento'; classe = passou ? 'status-expirado' : 'status-pendente'; }

        var info = '';
        if (!passou) info += '<p class="ag-quando"><i class="far fa-clock"></i> ' + esc(RodUtil.quando(ag.data, ag.hora)) + '</p>';
        if (!pago && !passou && ag.pagarAte) info += '<p class="pagar-ate"><i class="far fa-hourglass-half"></i> Pague até ' + esc(RodUtil.prazoBR(ag.pagarAte)) + ' ou a vaga é liberada</p>';

        var acoes = '';
        if (!passou && !pago) {
            if (ag.pixCopiaCola) acoes += '<button type="button" class="btn-pagar" data-acao="pix" data-id="' + esc(ag._id) + '"><i class="fa-brands fa-pix"></i> Pagar com PIX</button>';
            if (/^https:\/\//.test(ag.urlPagamentoCartao || '')) acoes += '<a href="' + esc(ag.urlPagamentoCartao) + '" target="_blank" rel="noopener noreferrer" class="btn-card"><i class="far fa-credit-card"></i> Cartão</a>';
            acoes += '<button type="button" class="btn-cancelar" data-acao="cancelar" data-id="' + esc(ag._id) + '"><i class="far fa-trash-can"></i> Cancelar</button>';
        } else if (!passou && pago) {
            if ((ag.remarcacoes || 0) < 2 && RodUtil.instante(ag.data, ag.hora).getTime() - Date.now() > 2 * 3600e3) acoes += '<button type="button" class="btn-sec" data-acao="remarcar" data-id="' + esc(ag._id) + '"><i class="fas fa-calendar-days"></i> Remarcar</button>';
            acoes += '<button type="button" class="btn-sec" data-acao="ics" data-id="' + esc(ag._id) + '"><i class="far fa-calendar-plus"></i> Adicionar à agenda</button>';
            acoes += '<a class="btn-sec" href="' + esc(RodUtil.linkMapa()) + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-location-arrow"></i> Como chegar</a>';
            acoes += '<a class="btn-sec discreto" href="' + esc(RodUtil.linkWhats('Olá! Preciso remarcar ou cancelar meu horário de ' + RodUtil.dataBR(ag.data) + ' às ' + ag.hora + ' (' + ag.servico + ').')) + '" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp"></i> Remarcar / cancelar</a>';
        } else {
            acoes += '<a class="btn-sec" href="/#agendamento"><i class="fas fa-rotate-right"></i> Agendar de novo</a>';
        }

        return '<article class="agendamento-card ' + (pago ? 'pago' : 'pendente') + (passou ? ' passado' : '') + (destaque ? ' destaque' : '') + '">' +
            (destaque ? '<span class="ag-selo"><i class="fas fa-bolt"></i> Próximo corte</span>' : '') +
            '<div class="ag-data" aria-hidden="true"><span class="ag-dia-sem">' + esc(RodUtil.diaDaSemana(ag.data, 'short')) + '</span><span class="ag-dia">' + esc(ag.data.slice(8)) + '</span><span class="ag-mes">' + esc(mes) + '</span></div>' +
            '<div class="ag-corpo">' +
            '<h3 class="card-service">' + esc(ag.servico) + '</h3>' +
            '<p class="card-date"><i class="far fa-calendar-alt"></i> ' + esc(RodUtil.dataBR(ag.data)) + ' às ' + esc(ag.hora) + '</p>' +
            info + '</div>' +
            '<div class="ag-lado"><span class="status-badge ' + classe + '">' + rotulo + '</span><strong class="ag-valor">' + esc(RodUtil.brl(ag.valor)) + '</strong></div>' +
            (acoes ? '<div class="card-actions">' + acoes + '</div>' : '') +
            '</article>';
    }

    function desenhar() {
        var box = $('lista-agendamentos');
        if (!lista.length) { box.innerHTML = vazio(); return; }
        var proximos = lista.filter(function (a) { return !jaTerminou(a); }).sort(function (a, b) { return (a.data + a.hora) < (b.data + b.hora) ? -1 : 1; });
        var passados = lista.filter(jaTerminou).sort(function (a, b) { return (a.data + a.hora) < (b.data + b.hora) ? 1 : -1; });
        var html = '';
        if (proximos.length) {
            html += '<h2 class="ag-secao"><i class="fas fa-calendar-day"></i> Próximos <span>' + proximos.length + '</span></h2>';
            proximos.forEach(function (a, i) { html += cartao(a, i === 0); });
        } else {
            html += '<div class="proximos-vazio"><i class="far fa-calendar"></i> Nenhum corte futuro. <a href="/#agendamento">Agendar agora</a></div>';
        }
        if (passados.length) {
            html += '<h2 class="ag-secao historico"><i class="fas fa-clock-rotate-left"></i> Histórico <span>' + passados.length + '</span></h2>';
            passados.forEach(function (a) { html += cartao(a, false); });
        }
        box.innerHTML = html;
    }

    async function carregar() {
        if (!RodAuth.token()) { window.location.href = '/login'; return; }
        if (RodAuth.papel() === 'owner') { window.location.replace('/admin'); return; }
        var box = $('lista-agendamentos');
        var nome = ''; try { nome = (localStorage.getItem('usuarioNome') || '').split(' ')[0]; } catch (e) {}
        if (nome) $('ola').textContent = 'Olá, ' + nome + '! Aqui estão os seus horários.';
        try {
            var res = await RodAuth.fetch(API_URL + '/meus-agendamentos');
            if (!res.ok) throw new Error('falha');
            lista = await res.json();
            desenhar();
        } catch (e) {
            if (e && e.message === 'sessao_expirada') return;
            box.innerHTML = erroCarregar();
            var b = $('btn-recarregar'); if (b) b.addEventListener('click', function () { box.innerHTML = esqueleto(); carregar(); });
        }
    }

    function achar(id) { return lista.filter(function (a) { return a._id === id; })[0]; }

    // ----- delegação de cliques nos botões dos cartões
    $('lista-agendamentos').addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-acao]'); if (!el) return;
        var ag = achar(el.dataset.id); if (!ag) return;
        if (el.dataset.acao === 'pix') abrirModal(ag);
        else if (el.dataset.acao === 'cancelar') cancelar(ag);
        else if (el.dataset.acao === 'remarcar') remarcar(ag);
        else if (el.dataset.acao === 'ics') RodUtil.baixarIcs({ id: ag._id, servico: ag.servico, data: ag.data, hora: ag.hora });
    });

    // ----- PIX
    function abrirModal(ag) {
        if (/^[A-Za-z0-9+\/=]+$/.test(ag.qrCodeBase64 || '')) $('qr-image').src = 'data:image/png;base64,' + ag.qrCodeBase64;
        $('pix-text').value = ag.pixCopiaCola || '';
        $('modal-pix').style.display = 'flex';
        $('modal-pix').querySelector('.modal-fechar').focus();
        iniciarVerificacao(ag.pagamentoId);
    }
    window.fecharModal = function () { $('modal-pix').style.display = 'none'; clearInterval(intervaloVerificacao); };
    window.copiarPix = function () {
        RodUtil.copiar($('pix-text').value).then(function (ok) { Toast.fire({ icon: ok ? 'success' : 'error', title: ok ? 'Código copiado!' : 'Não consegui copiar. Selecione e copie o código.' }); });
    };
    $('modal-pix').addEventListener('click', function (e) { if (e.target === this) fecharModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('modal-pix').style.display === 'flex') fecharModal(); });

    function iniciarVerificacao(id) {
        clearInterval(intervaloVerificacao);
        var ocupado = false, inicio = Date.now();
        intervaloVerificacao = setInterval(async function () {
            if (ocupado || document.hidden) return;
            if (Date.now() - inicio > 30 * 60000) { clearInterval(intervaloVerificacao); return; }
            ocupado = true;
            try {
                var res = await RodAuth.fetch(API_URL + '/status-pagamento/' + encodeURIComponent(id));
                var data = await res.json();
                if (data.status === 'approved') {
                    clearInterval(intervaloVerificacao);
                    fecharModal();
                    await Tema.fire({ icon: 'success', title: 'Pagamento confirmado!', text: 'Seu horário está garantido. Enviamos a confirmação por e-mail.', confirmButtonText: 'Ótimo' });
                    carregar();
                }
            } catch (e) { /* tenta de novo */ }
            ocupado = false;
        }, 3000);
    }

    // ----- cancelar (só horários ainda não pagos)
    async function cancelar(ag) {
        var r = await Tema.fire({
            title: 'Cancelar este horário?', icon: 'warning',
            html: '<b>' + esc(ag.servico) + '</b><br>' + esc(RodUtil.dataBR(ag.data)) + ' às ' + esc(ag.hora) + '<br><small style="color:#b2a996">A vaga será liberada e o PIX deixa de valer.</small>',
            showCancelButton: true, confirmButtonColor: '#cf4a40', confirmButtonText: 'Sim, cancelar', cancelButtonText: 'Voltar'
        });
        if (!r.isConfirmed) return;
        try {
            var resp = await RodAuth.fetch(API_URL + '/agendamentos/' + encodeURIComponent(ag._id), { method: 'DELETE' });
            var corpo = await resp.json().catch(function () { return {}; });
            if (!resp.ok) { await Tema.fire({ icon: resp.status === 409 ? 'info' : 'error', title: resp.status === 409 ? 'Pagamento já confirmado' : 'Não foi possível cancelar', text: corpo.mensagem || 'Tente novamente em instantes.' }); carregar(); return; }
            Toast.fire({ icon: 'success', title: 'Horário cancelado.' });
            carregar();
        } catch (e) {
            if (e && e.message === 'sessao_expirada') return;
            Tema.fire({ icon: 'error', title: 'Sem conexão', text: 'Confira sua internet e tente de novo.' });
        }
    }

    // ----- remarcar (horários pagos, até 2h antes, no máximo 2 vezes)
    function remarcar(ag) {
        RodSeletor.abrir({
            api: API_URL, titulo: 'Remarcar horário', textoBotao: 'Confirmar nova data',
            subtitulo: '<b>' + esc(ag.servico) + '</b> · marcado para ' + esc(RodUtil.dataBR(ag.data)) + ' às ' + esc(ag.hora) + '<br><small>Você pode remarcar até 2 vezes, até 2 horas antes.</small>',
            aoConfirmar: async function (sel) {
                var resp = await RodAuth.fetch(API_URL + '/agendamentos/' + encodeURIComponent(ag._id) + '/remarcar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: sel.data, hora: sel.hora }) });
                var corpo = await resp.json().catch(function () { return {}; });
                if (!resp.ok) return corpo.mensagem || 'Não foi possível remarcar.';
                Toast.fire({ icon: 'success', title: 'Remarcado para ' + RodUtil.dataBR(sel.data) + ' às ' + sel.hora });
                carregar();
                return null;
            }
        });
    }

    // ----- meus dados
    var perfil = null;
    function desenharPerfil() {
        var box = $('perfil-card'); if (!perfil) return;
        var tel = perfil.telefone ? '(' + perfil.telefone.slice(0, 2) + ') ' + perfil.telefone.slice(2, perfil.telefone.length - 4) + '-' + perfil.telefone.slice(-4) : '';
        box.hidden = false;
        box.innerHTML = '<span class="avatar-mini" aria-hidden="true">' + esc(perfil.nome.trim().charAt(0).toUpperCase()) + '</span>' +
            '<div class="perfil-info"><strong>' + esc(perfil.nome) + '</strong><span>' + esc(perfil.email) + '</span>' +
            (tel ? '<span><i class="fab fa-whatsapp"></i> ' + esc(tel) + '</span>' : '<span class="perfil-dica"><i class="fab fa-whatsapp"></i> Adicione seu WhatsApp para o Rod falar com você se precisar.</span>') + '</div>' +
            '<button type="button" class="btn-sec" id="btn-editar-perfil"><i class="fas fa-pen"></i> Editar</button>';
        $('btn-editar-perfil').addEventListener('click', editarPerfil);
    }
    async function carregarPerfil() {
        try { var r = await RodAuth.fetch(API_URL + '/meu-perfil'); if (r.ok) { perfil = await r.json(); desenharPerfil(); } } catch (e) { /* opcional */ }
    }
    async function editarPerfil() {
        var r = await Tema.fire({
            title: 'Meus dados', showCancelButton: true, confirmButtonText: 'Salvar', cancelButtonText: 'Voltar',
            html: '<label class="swal-rotulo" for="pf-nome">Nome</label><input id="pf-nome" class="swal2-input" maxlength="80" autocomplete="name">' +
                  '<label class="swal-rotulo" for="pf-tel">WhatsApp (opcional)</label><input id="pf-tel" class="swal2-input" type="tel" inputmode="tel" maxlength="16" placeholder="(11) 91234-5678" autocomplete="tel-national">',
            didOpen: function () {
                document.getElementById('pf-nome').value = perfil.nome;
                var t = document.getElementById('pf-tel'); RodUI.mascaraTelefone(t);
                t.value = perfil.telefone || ''; t.dispatchEvent(new Event('input'));
            },
            preConfirm: async function () {
                var nome = document.getElementById('pf-nome').value.trim(), tel = document.getElementById('pf-tel').value.replace(/\D/g, '');
                if (nome.length < 2) { Swal.showValidationMessage('Informe seu nome.'); return false; }
                if (tel && tel.length !== 10 && tel.length !== 11) { Swal.showValidationMessage('WhatsApp incompleto: use DDD + número.'); return false; }
                try {
                    var resp = await RodAuth.fetch(API_URL + '/meu-perfil', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nome, telefone: tel }) });
                    var corpo = await resp.json().catch(function () { return {}; });
                    if (!resp.ok) { Swal.showValidationMessage(corpo.mensagem || 'Não foi possível salvar.'); return false; }
                    return corpo;
                } catch (e) { Swal.showValidationMessage('Sem conexão.'); return false; }
            }
        });
        if (!r.isConfirmed || !r.value) return;
        perfil = r.value;
        try { localStorage.setItem('usuarioNome', perfil.nome); } catch (e) {}
        $('ola').textContent = 'Olá, ' + perfil.nome.split(' ')[0] + '! Aqui estão os seus horários.';
        desenharPerfil();
        Toast.fire({ icon: 'success', title: 'Dados atualizados!' });
    }

    // ----- excluir a própria conta (LGPD)
    async function excluirConta() {
        var r = await Tema.fire({
            title: 'Excluir minha conta?', icon: 'warning',
            html: 'Seus dados pessoais serão removidos e as reservas ainda não pagas serão canceladas.<br><small style="color:#b2a996">Essa ação não pode ser desfeita. Digite sua senha para confirmar.</small>',
            input: 'password', inputPlaceholder: 'Sua senha', inputAttributes: { autocomplete: 'current-password', maxlength: 72 },
            showCancelButton: true, confirmButtonColor: '#cf4a40', confirmButtonText: 'Excluir definitivamente', cancelButtonText: 'Voltar',
            preConfirm: function (v) { if (!v) { Swal.showValidationMessage('Digite sua senha.'); return false; } return v; }
        });
        if (!r.isConfirmed) return;
        try {
            var resp = await RodAuth.fetch(API_URL + '/minha-conta', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: r.value }) });
            var corpo = await resp.json().catch(function () { return {}; });
            if (!resp.ok) { await Tema.fire({ icon: 'error', title: 'Não foi possível excluir', text: corpo.mensagem || 'Tente novamente em instantes.' }); return; }
            await Tema.fire({ icon: 'success', title: 'Conta excluída', text: corpo.mensagem || 'Seus dados foram removidos.', confirmButtonText: 'Ok' });
            try { localStorage.clear(); } catch (e) {}
            window.location.href = '/';
        } catch (e) {
            if (e && e.message === 'sessao_expirada') return;
            Tema.fire({ icon: 'error', title: 'Sem conexão', text: 'Confira sua internet e tente de novo.' });
        }
    }
    $('btn-excluir-conta').addEventListener('click', excluirConta);

    // atualiza prazos/estados quando a pessoa volta para a aba
    document.addEventListener('visibilitychange', function () { if (!document.hidden && lista.length) carregar(); });
    // durações atuais (usadas para saber quando o corte termina e no arquivo do calendário)
    fetch(API_URL + '/servicos').then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { (l || []).forEach(function (s) { RodUtil.duracoes[s.nome] = Number(s.minutos) || 40; }); if (lista.length) desenhar(); }).catch(function () {});
    document.addEventListener('DOMContentLoaded', function () { carregar(); if (RodAuth.token() && RodAuth.papel() !== 'owner') carregarPerfil(); });
})();

(function () {
    var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    function payload() {
        try {
            var corpo = (window.RodAuth.token() || "").split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
            return JSON.parse(atob(corpo));
        } catch (e) { return null; }
    }

    window.RodAuth = {
        token: function () {
            try { return localStorage.getItem('token'); } catch (e) { return null; }
        },
        // papel gravado no token (só para decidir o que mostrar; quem valida de verdade é o servidor)
        papel: function () {
            var p = payload();
            return p && p.role || null;
        },
        // há um token que ainda não venceu (o servidor continua sendo quem decide)
        logado: function () {
            var p = payload();
            return Boolean(p && p.exp && p.exp > Date.now() / 1000);
        },
        // remove a sessão e volta para o login
        sair: function () {
            try { localStorage.clear(); } catch (e) {}
            window.location.href = '/login';
        },
        // fetch que envia o token; se o servidor disser que a sessão acabou, volta para o login
        fetch: async function (url, opcoes) {
            var op = Object.assign({}, opcoes);
            op.headers = Object.assign({}, op.headers);
            var t = this.token();
            if (t) op.headers.Authorization = 'Bearer ' + t;
            var resposta = await fetch(url, op);
            if (resposta.status === 401) {
                this.sair();
                throw new Error('sessao_expirada');
            }
            return resposta;
        },
        // escapa texto antes de colocar em innerHTML (evita XSS com dados vindos do banco)
        esc: function (valor) {
            return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) { return ESC[c]; });
        }
    };
})();

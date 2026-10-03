        (function () {
            var API_URL = 'https://rodbarber-api-0jna.onrender.com';
            if (RodUI.pularSeLogado()) return;
            RodUI.aquecer(API_URL);

            var form = document.getElementById('form-login');
            var mensagem = document.getElementById('mensagem');
            var email = document.getElementById('email'), senha = document.getElementById('senha');
            RodUI.campoSenha(senha);
            try { var ultimo = sessionStorage.getItem('ultimoEmail'); if (ultimo) email.value = ultimo; } catch (e) {}
            (email.value ? senha : email).focus();

            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var btn = form.querySelector('button[type="submit"]');
                var em = email.value.trim().toLowerCase();
                if (!em || !senha.value) { RodUI.mensagem(mensagem, 'erro', 'Informe o e-mail e a senha.'); (em ? senha : email).focus(); return; }
                if (!/^\S+@\S+\.\S+$/.test(em)) { RodUI.mensagem(mensagem, 'erro', 'Esse e-mail não parece válido.'); email.focus(); return; }

                RodUI.carregando(btn, true, 'Entrando...');
                RodUI.mensagem(mensagem, '', '');
                var lento = setTimeout(function () { RodUI.mensagem(mensagem, 'info', 'O servidor está acordando, isso pode levar alguns segundos...'); }, 3500);
                try {
                    var response = await fetch(API_URL + '/login', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: em, senha: senha.value })
                    });
                    var data = await response.json().catch(function () { return {}; });
                    clearTimeout(lento);
                    if (response.ok) {
                        RodUI.mensagem(mensagem, 'ok', 'Login realizado! Redirecionando...');
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('usuarioNome', data.usuario.nome);
                        localStorage.setItem('usuarioEmail', data.usuario.email);
                        try { sessionStorage.removeItem('ultimoEmail'); } catch (x) {}
                        // o dono vai direto para o painel dele; clientes vão para o site
                        var destino = data.usuario.dono ? '/admin' : '/#agendamento';
                        setTimeout(function () { window.location.href = destino; }, 700);
                    } else {
                        RodUI.mensagem(mensagem, 'erro', data.erro || 'Não foi possível entrar.');
                        RodUI.carregando(btn, false);
                        senha.select();
                    }
                } catch (err) {
                    clearTimeout(lento);
                    RodUI.mensagem(mensagem, 'erro', 'Sem conexão com o servidor. Confira sua internet e tente de novo.');
                    RodUI.carregando(btn, false);
                }
            });
        })();

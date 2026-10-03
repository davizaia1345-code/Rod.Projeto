        (function () {
            var API_URL = 'https://rodbarber-api-0jna.onrender.com';
            if (RodUI.pularSeLogado()) return;
            RodUI.aquecer(API_URL);

            var form = document.getElementById('form-cadastro');
            var mensagem = document.getElementById('mensagem');
            var nome = document.getElementById('nome'), email = document.getElementById('email'), senha = document.getElementById('senha'), tel = document.getElementById('telefone');
            RodUI.mascaraTelefone(tel);
            RodUI.campoSenha(senha);
            RodUI.medidorForca(senha);
            nome.focus();

            function falha(texto, campo) { RodUI.mensagem(mensagem, 'erro', texto); if (campo) campo.focus(); }

            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                var btn = form.querySelector('button[type="submit"]');
                var n = nome.value.trim().replace(/\s+/g, ' '), em = email.value.trim().toLowerCase();
                if (n.length < 2) return falha('Informe seu nome.', nome);
                if (!/^\S+@\S+\.\S+$/.test(em)) return falha('Esse e-mail não parece válido.', email);
                var digitos = tel.value.replace(/\D/g, '');
                if (digitos && digitos.length !== 10 && digitos.length !== 11) return falha('WhatsApp incompleto: use DDD + número (ou deixe em branco).', tel);
                if (senha.value.length < 8) return falha('A senha precisa ter pelo menos 8 caracteres.', senha);

                RodUI.carregando(btn, true, 'Criando conta...');
                RodUI.mensagem(mensagem, '', '');
                var lento = setTimeout(function () { RodUI.mensagem(mensagem, 'info', 'O servidor está acordando, isso pode levar alguns segundos...'); }, 3500);
                try {
                    var response = await fetch(API_URL + '/cadastro', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nome: n, email: em, senha: senha.value, telefone: digitos })
                    });
                    var data = await response.json().catch(function () { return {}; });
                    if (!response.ok) {
                        clearTimeout(lento);
                        RodUI.mensagem(mensagem, 'erro', data.erro || 'Não foi possível criar a conta.');
                        RodUI.carregando(btn, false);
                        return;
                    }
                    // conta criada: já entra direto, sem precisar digitar tudo de novo
                    RodUI.mensagem(mensagem, 'ok', 'Conta criada! Entrando...');
                    try {
                        var lr = await fetch(API_URL + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, senha: senha.value }) });
                        var ld = await lr.json().catch(function () { return {}; });
                        clearTimeout(lento);
                        if (lr.ok) {
                            localStorage.setItem('token', ld.token);
                            localStorage.setItem('usuarioNome', ld.usuario.nome);
                            localStorage.setItem('usuarioEmail', ld.usuario.email);
                            setTimeout(function () { window.location.href = '/#agendamento'; }, 700);
                            return;
                        }
                    } catch (x) { /* cai no login manual abaixo */ }
                    clearTimeout(lento);
                    try { sessionStorage.setItem('ultimoEmail', em); } catch (x) {}
                    setTimeout(function () { window.location.href = '/login'; }, 1200);
                } catch (err) {
                    clearTimeout(lento);
                    RodUI.mensagem(mensagem, 'erro', 'Sem conexão com o servidor. Confira sua internet e tente de novo.');
                    RodUI.carregando(btn, false);
                }
            });
        })();

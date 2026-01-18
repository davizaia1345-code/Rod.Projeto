// ===============================
// CONFIG
// ===============================
const API_URL = "http://localhost:3001/agendar";
// depois você troca pela URL do Render

// ===============================
// ELEMENTOS
// ===============================
const form = document.getElementById("form-agendamento");
const mensagem = document.getElementById("mensagem");

// ===============================
// EVENTOS
// ===============================
form.addEventListener("submit", handleSubmit);

// ===============================
// FUNÇÕES
// ===============================
async function handleSubmit(event) {
  event.preventDefault();

  const dados = getFormData();

  if (!dados) return;

  setLoading(true);

  try {
    const response = await enviarAgendamento(dados);
    mostrarMensagem(response.mensagem || "Agendamento realizado com sucesso ✅", "sucesso");
    form.reset();
  } catch (error) {
    mostrarMensagem(error.message || "Erro ao agendar ❌", "erro");
  } finally {
    setLoading(false);
  }
}

function getFormData() {
  const nome = document.getElementById("nome").value.trim();
  const data = document.getElementById("data").value;
  const hora = document.getElementById("hora").value;

  if (!nome || !data || !hora) {
    mostrarMensagem("Preencha todos os campos.", "erro");
    return null;
  }

  return { nome, data, hora };
}

async function enviarAgendamento(dados) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dados)
  });

  if (!response.ok) {
    throw new Error("Falha na comunicação com o servidor");
  }

  return response.json();
}

function mostrarMensagem(texto, tipo) {
  mensagem.innerText = texto;
  mensagem.style.color = tipo === "sucesso" ? "lightgreen" : "#ff6b6b";
}

function setLoading(ativo) {
  const button = form.querySelector("button");
  button.disabled = ativo;
  button.innerText = ativo ? "Agendando..." : "Agendar";
}

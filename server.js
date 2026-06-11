const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const mercadopago = require('mercadopago');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 CONFIGURAÇÕES
const JWT_SECRET = 'chave_secreta_delivery_2026_abc123';
const MERCADO_PAGO_TOKEN = 'SEU_TOKEN_AQUI'; // Troque depois quando tiver o do Mercado Pago
const SENHA_MESTRA = '123456'; // Você pode mudar depois

// 🗄️ CONEXÃO COM O SEU BANCO
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://banco_delivery_btxl_user:wARkRLmjw2YDkkNwJUZZ7o2v4slDRFXG@dpg-d8l0cee7r5hc739g95hg-a.frankfurt-postgres.render.com/banco_delivery_btxl',
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());

// 📦 CRIAR TABELAS AUTOMATICAMENTE
async function criarTabelas() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome_completo VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        senha VARCHAR(255) NOT NULL,
        telefone VARCHAR(20),
        data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lojas (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id),
        nome_fantasia VARCHAR(100) NOT NULL,
        descricao TEXT,
        cidade VARCHAR(50) DEFAULT 'Marechal Cândido Rondon',
        telefone_whatsapp VARCHAR(20),
        taxa_entrega DECIMAL(5,2) DEFAULT 4.99,
        tempo_medio_min INT DEFAULT 30,
        aberto BOOLEAN DEFAULT true,
        horario_abertura TIME DEFAULT '18:00',
        horario_fechamento TIME DEFAULT '23:00',
        aceita_pedidos BOOLEAN DEFAULT true,
        plano VARCHAR(20) DEFAULT 'basico',
        ativa BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        loja_id INT REFERENCES lojas(id) ON DELETE CASCADE,
        nome VARCHAR(50) NOT NULL,
        ordem INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        loja_id INT REFERENCES lojas(id) ON DELETE CASCADE,
        categoria_id INT REFERENCES categorias(id) ON DELETE SET NULL,
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        preco_base DECIMAL(6,2) NOT NULL,
        disponivel BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS tamanhos (
        id SERIAL PRIMARY KEY,
        produto_id INT REFERENCES produtos(id) ON DELETE CASCADE,
        nome VARCHAR(30) NOT NULL,
        preco_adicional DECIMAL(5,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS bordas (
        id SERIAL PRIMARY KEY,
        produto_id INT REFERENCES produtos(id) ON DELETE CASCADE,
        nome VARCHAR(50) NOT NULL,
        preco_adicional DECIMAL(5,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS adicionais (
        id SERIAL PRIMARY KEY,
        produto_id INT REFERENCES produtos(id) ON DELETE CASCADE,
        nome VARCHAR(50) NOT NULL,
        preco_adicional DECIMAL(5,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        loja_id INT REFERENCES lojas(id) ON DELETE CASCADE,
        cliente_nome VARCHAR(100) NOT NULL,
        cliente_telefone VARCHAR(20) NOT NULL,
        endereco_rua VARCHAR(150) NOT NULL,
        endereco_bairro VARCHAR(50) NOT NULL,
        endereco_complemento VARCHAR(100),
        forma_pagamento VARCHAR(30) NOT NULL,
        valor_total DECIMAL(6,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'novo',
        data_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS itens_pedido (
        id SERIAL PRIMARY KEY,
        pedido_id INT REFERENCES pedidos(id) ON DELETE CASCADE,
        produto_nome VARCHAR(100) NOT NULL,
        quantidade INT NOT NULL,
        preco_unitario DECIMAL(6,2) NOT NULL,
        observacoes TEXT
      );
    `);
    console.log('Tabelas criadas com sucesso!');
  } catch (erro) {
    console.error('Erro ao criar tabelas:', erro);
  }
}

criarTabelas();

// 🔐 Verificar login
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ erro: 'Acesso não autorizado' });
  const token = authHeader.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido' });
  }
}

// 📌 ROTAS DO SISTEMA
app.get('/api/lojas', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nome_fantasia, descricao, cidade, taxa_entrega, tempo_medio_min FROM lojas WHERE ativa = true');
    res.json(resultado.rows);
  } catch { res.status(500).json({ erro: 'Erro ao carregar lojas' }); }
});

app.get('/api/lojas/:id', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM lojas WHERE id = $1 AND ativa = true', [req.params.id]);
    resultado.rows.length ? res.json(resultado.rows[0]) : res.status(404).json({ erro: 'Loja não encontrada' });
  } catch { res.status(500).json({ erro: 'Erro' }); }
});

app.get('/api/lojas/:id/status', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT aberto, horario_abertura, horario_fechamento FROM lojas WHERE id = $1', [req.params.id]);
    if (!resultado.rows.length) return res.json({ aberto: false, mensagem: 'Fechado' });
    const loja = resultado.rows[0];
    const agora = new Date();
    const hora = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
    const estaAberto = loja.aberto && hora >= loja.horario_abertura && hora < loja.horario_fechamento;
    res.json({ aberto: estaAberto, horario: `${loja.horario_abertura} às ${loja.horario_fechamento}` });
  } catch { res.json({ aberto: false }); }
});

app.get('/api/categorias', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM categorias WHERE loja_id = $1 ORDER BY ordem', [req.query.loja]);
    res.json(resultado.rows);
  } catch { res.status(500).json({ erro: 'Erro' }); }
});

app.get('/api/produtos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM produtos WHERE loja_id = $1 AND disponivel = true', [req.query.loja]);
    const produtosCompletos = await Promise.all(resultado.rows.map(async (produto) => ({
      ...produto,
      tamanhos: (await pool.query('SELECT id, nome, preco_adicional FROM tamanhos WHERE produto_id = $1', [produto.id])).rows,
      bordas: (await pool.query('SELECT id, nome, preco_adicional FROM bordas WHERE produto_id = $1', [produto.id])).rows,
      adicionais: (await pool.query('SELECT id, nome, preco_adicional FROM adicionais WHERE produto_id = $1', [produto.id])).rows
    })));
    res.json(produtosCompletos);
  } catch { res.status(500).json({ erro: 'Erro' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (!usuario.rows.length) return res.json({ sucesso: false, mensagem: 'E-mail não cadastrado' });
    const senhaCorreta = await bcrypt.compare(senha, usuario.rows[0].senha);
    if (!senhaCorreta) return res.json({ sucesso: false, mensagem: 'Senha incorreta' });
    const loja = await pool.query('SELECT id FROM lojas WHERE usuario_id = $1', [usuario.rows[0].id]);
    const token = jwt.sign({ id: usuario.rows[0].id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ sucesso: true, token, loja_id: loja.rows[0].id });
  } catch { res.json({ sucesso: false, mensagem: 'Erro no servidor' }); }
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));

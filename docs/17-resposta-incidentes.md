# 17 — Plano de resposta a incidentes de segurança

> Prazos e critérios de comunicação à ANPD e aos titulares devem seguir a regulamentação vigente e ser confirmados pelo encarregado/jurídico da rede. Este plano não fixa prazos legais.

## 1. Papéis
| Papel | Responsabilidade |
|---|---|
| Coordenador do incidente (TI) | Conduz contenção e recuperação |
| Encarregado (DPO) | Avalia impacto a titulares e necessidade de comunicação |
| Jurídico | Obrigações legais e contratuais |
| Comunicação | Mensagens a clientes/imprensa, se necessário |
| Fornecedores | Meta/BSP, Anthropic, nuvem, PMS — contatos de segurança a registrar |

## 2. Classificação
- **Sev 1**: exposição confirmada de dados pessoais, comprometimento de credenciais de produção, operações indevidas em reservas.
- **Sev 2**: suspeita de acesso indevido, ataque em andamento (ex.: enumeração), indisponibilidade prolongada.
- **Sev 3**: falha de controle sem exposição confirmada.

## 3. Fluxo

1. **Identificação** — fontes: alertas do WF11 (assinaturas inválidas, verificações bloqueadas, erros "alerta" da Cloud API), auditoria, relato de cliente/equipe. Abrir registro com horário, fonte e responsável.
2. **Contenção** (conforme o caso):
   - Suspender automação: despublicar WF01 (n8n) ou responder 503 no proxy; conversas existentes podem ser colocadas em `suspensa`.
   - Revogar/rotacionar: tokens do core (remover hash de `SERVICE_TOKENS`), token da Meta, chave Anthropic, credencial do PMS, `DATA_ENCRYPTION_KEY` (nova chave + antiga em `DATA_ENCRYPTION_OLD_KEYS` até re-cifrar), `HASH_PEPPER` (exige plano de migração).
   - Bloquear origem no proxy/WAF.
3. **Preservação de evidências** — exportar `registro_auditoria`, `erro_operacional`, logs da aplicação e do proxy, execuções de erro do n8n do período; registrar hashes dos arquivos; não alterar o ambiente além do necessário para conter.
4. **Avaliação de impacto** — quais dados (ver `15-inventario-dados.md`), quantos titulares, se cifrados, risco aos titulares.
5. **Comunicação** — encarregado decide sobre comunicação à ANPD e aos titulares conforme regulamentação; notificar fornecedores envolvidos.
6. **Erradicação e recuperação** — corrigir causa, restaurar a partir de backup íntegro se necessário, reativar gradualmente com monitoramento reforçado.
7. **Registro e lições** — relatório com linha do tempo, causa raiz, medidas adotadas, plano de correção e responsáveis; atualizar esta documentação e testes.

## 4. Consultas úteis
```sql
-- Operações sensíveis em um período
SELECT instante, ator, operacao, recurso, resultado FROM registro_auditoria
WHERE instante BETWEEN $1 AND $2 AND operacao IN (
 'reserva.consulta','reserva.verificacao_titular','reserva.verificacao_bloqueada','reserva.cancelada',
 'privacidade.exportacao','privacidade.eliminacao','atendimento.leitura_mensagens','ferramenta.nao_autorizada')
ORDER BY instante;
```

## 5. Testes do plano
Simulação (tabletop) semestral e após mudanças relevantes; checklist de rotação de credenciais testado em homologação.

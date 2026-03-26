const { processDocument } = require('./geminiService');
const { getOrCreateClientFolder, uploadFile, getSubfolderInUserFolder } = require('./googleDriveService');
const { getContext, setContext, getPendingFiles, clearPendingFiles } = require('./contextService');

// ── Processar lote inteiro ──────────────────────────────
async function processBatch(pool, convId, batchId) {
  const files = await getPendingFiles(convId, batchId);
  if (files.length === 0) return null;

  console.log(`[BATCH] Processando lote ${batchId}: ${files.length} arquivo(s)`);

  // 1. Extrair dados de cada documento com IA
  const extractions = [];
  for (const file of files) {
    try {
      const result = await processDocument(file.base64_data, file.mime_type, file.file_name);
      extractions.push({
        file,
        data: result,
        patient: (result.nome_cliente || '').toUpperCase().trim() || null,
        owner: null, // será extraído do contexto ou do documento
        hospital: null,
        docType: result.tipo_documento || 'Outro'
      });
      console.log(`[BATCH] Extraído: ${file.file_name} → ${result.tipo_documento} / ${result.nome_cliente || '—'}`);
    } catch (err) {
      console.error(`[BATCH] Erro extraindo ${file.file_name}:`, err.message);
      extractions.push({ file, data: null, patient: null, owner: null, hospital: null, docType: 'Erro' });
    }
  }

  // 2. Buscar contexto da conversa
  const ctx = await getContext(convId);

  // 3. Consolidar: determinar caso dominante
  const consolidated = consolidateBatch(extractions, ctx);
  console.log(`[BATCH] Consolidado: ${consolidated.caseName} (confiança: ${consolidated.confidence})`);

  // 4. Determinar pasta final
  let targetFolderId;

  if (ctx && ctx.destination_locked && ctx.active_folder_id) {
    // Destino já definido pelo usuário — usar direto
    targetFolderId = ctx.active_folder_id;
    console.log(`[BATCH] Usando destino travado: ${ctx.active_folder_id}`);
  } else {
    // Construir caminho baseado no contexto + consolidação
    targetFolderId = await buildFolderPath(consolidated, ctx);
  }

  // 5. Upload de todos os arquivos
  const results = [];
  for (let i = 0; i < extractions.length; i++) {
    const ext = extractions[i];
    try {
      const numStr = String(i + 1).padStart(3, '0');
      const cleanType = (ext.docType || 'Doc').replace(/\s+/g, '_');
      const finalName = `${numStr}_${cleanType}_${ext.file.file_name}`;

      const fileResult = await uploadFile(targetFolderId, finalName, ext.file.base64_data, ext.file.mime_type);

      // Salvar no banco
      await pool.query(
        `INSERT INTO documentos (batch_id, remetente_numero, remetente_nome, nome_arquivo_original, nome_arquivo_salvo, tipo_documento, descricao_gemini, patient_name, owner_name, hospital_name, link_drive, pasta_drive, numero_arquivo, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [batchId, convId, '', ext.file.file_name, fileResult.name, ext.docType, ext.data?.descricao,
         consolidated.patient, consolidated.owner, consolidated.hospital,
         fileResult.webViewLink, targetFolderId, i + 1, 'processado']
      );

      results.push({
        ok: true,
        fileName: fileResult.name,
        tipoDoc: ext.docType,
        descricao: ext.data?.descricao || '—',
        link: fileResult.webViewLink
      });
    } catch (err) {
      console.error(`[BATCH] Erro upload ${ext.file.file_name}:`, err.message);
      results.push({ ok: false, fileName: ext.file.file_name, tipoDoc: ext.docType, descricao: err.message });
    }
  }

  // 6. Limpar lote pendente
  await clearPendingFiles(convId, batchId);

  // 7. Atualizar contexto com o caso processado
  if (consolidated.patient || consolidated.owner) {
    await setContext(convId, {
      active_patient: consolidated.patient,
      active_owner: consolidated.owner,
      active_hospital: consolidated.hospital,
      active_folder_id: targetFolderId
    });
  }

  return {
    batchId,
    caseName: consolidated.caseName,
    patient: consolidated.patient,
    owner: consolidated.owner,
    hospital: consolidated.hospital,
    confidence: consolidated.confidence,
    results,
    folderPath: consolidated.folderPath || consolidated.caseName
  };
}

// ── Consolidar lote: encontrar caso dominante ───────────
function consolidateBatch(extractions, ctx) {
  const patients = {};
  const owners = {};
  const hospitals = {};
  const cpfs = {};

  for (const ext of extractions) {
    if (!ext.data) continue;

    const patient = (ext.data.nome_cliente || '').toUpperCase().trim();
    const cpf = ext.data.cpf || null;

    if (patient) patients[patient] = (patients[patient] || 0) + 1;
    if (cpf) cpfs[cpf] = (cpfs[cpf] || 0) + 1;
  }

  // Pegar dominantes
  const dominantPatient = getTopKey(patients);
  const dominantCpf = getTopKey(cpfs);

  // Usar contexto se disponível
  const hospital = ctx?.active_hospital || null;
  const owner = ctx?.active_owner || null;
  const patient = ctx?.active_patient || dominantPatient;

  // Nome do caso: PACIENTE - PROPRIETARIO
  let caseName;
  if (patient && owner) {
    caseName = `${patient} - ${owner}`;
  } else if (patient) {
    caseName = patient;
  } else if (owner) {
    caseName = owner;
  } else {
    caseName = `LOTE_${new Date().toISOString().substring(0, 10)}`;
  }

  // Calcular confiança
  const total = extractions.filter(e => e.data).length;
  const patientCount = patients[dominantPatient] || 0;
  const confidence = total > 0 ? patientCount / total : 0;

  // Detectar conflito
  const patientKeys = Object.keys(patients);
  const hasConflict = patientKeys.length > 1 && confidence < 0.6;

  // Montar caminho de pastas
  const pathParts = [];
  if (ctx?.active_root_folder) pathParts.push(ctx.active_root_folder);
  if (hospital) pathParts.push(hospital);
  pathParts.push(caseName);

  return {
    patient,
    owner,
    hospital,
    cpf: dominantCpf,
    caseName,
    folderPath: pathParts.join(' > '),
    confidence: Math.round(confidence * 100) / 100,
    hasConflict,
    conflictPatients: hasConflict ? patientKeys : null
  };
}

// ── Construir caminho de pastas no Drive ────────────────
async function buildFolderPath(consolidated, ctx) {
  let currentFolderId;

  // Raiz
  if (ctx?.active_root_folder) {
    const rootFolder = await getOrCreateClientFolder(ctx.active_root_folder);
    currentFolderId = rootFolder.id;
  } else {
    // Usar raiz do Drive configurada
    currentFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  }

  // Hospital
  if (consolidated.hospital) {
    currentFolderId = await getSubfolderInUserFolder(currentFolderId, consolidated.hospital);
  }

  // Pasta do caso
  currentFolderId = await getSubfolderInUserFolder(currentFolderId, consolidated.caseName);

  return currentFolderId;
}

function getTopKey(obj) {
  let max = 0, top = null;
  for (const [key, count] of Object.entries(obj)) {
    if (count > max) { max = count; top = key; }
  }
  return top;
}

module.exports = { processBatch };

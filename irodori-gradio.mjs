const generationPath = '/gradio_api/call/_run_generation';

async function requireSuccess(response, step) {
  if (response.ok) return response;
  await response.body?.cancel();
  throw new Error(`Gradio ${step}失败（HTTP ${response.status}）。`);
}

export async function readGradioGenerationParameters(fetchImpl, origin, options) {
  const info = await requireSuccess(await fetchImpl(`${origin}/gradio_api/info`, options), '读取接口');
  const metadata = await info.json().catch(() => null);
  const parameters = metadata?.named_endpoints?.['/_run_generation']?.parameters;
  if (!Array.isArray(parameters) || !parameters.some(param => param?.parameter_name === 'text')) {
    throw new Error('Gradio 未暴露 Irodori 语音生成接口。');
  }
  return parameters;
}

export async function synthesizeGradio(fetchImpl, origin, { input, voice, caption }, signal) {
  const options = { signal, redirect: 'error' };
  const parameters = await readGradioGenerationParameters(fetchImpl, origin, options);
  const useDefault = voice === 'default';
  const hasSpeakerInput = parameters.some(param => param.parameter_name === 'speaker_embedding_path_raw');
  if (!useDefault && voice !== 'none' && (!hasSpeakerInput || !/^[\w-]+$/.test(voice))) {
    throw new Error('Gradio 的 Voice ID 可填 default、none 或 voices 目录中的说话人嵌入 ID。');
  }
  const values = {
    text: input, caption: caption || '', num_candidates: 1,
    uploaded_audio: null, uploaded_speaker_embedding: null, ref_wavs: null,
    ...(!useDefault ? { speaker_embedding_path_raw: voice === 'none' ? '' : `voices/${voice}.speaker.safetensors` } : {}),
  };
  const data = parameters.map(param => {
    if (Object.hasOwn(values, param.parameter_name)) return values[param.parameter_name];
    if (param.parameter_has_default) return param.parameter_default;
    throw new Error(`Gradio 语音接口缺少参数默认值：${param.parameter_name}。`);
  });
  const job = await requireSuccess(await fetchImpl(`${origin}${generationPath}`, {
    ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }),
  }), '提交生成');
  const { event_id: eventId } = await job.json();
  if (typeof eventId !== 'string' || !/^[\w-]+$/.test(eventId)) throw new Error('Gradio 未返回生成任务 ID。');
  const events = await requireSuccess(await fetchImpl(`${origin}${generationPath}/${eventId}`, options), '读取生成结果');
  const complete = (await events.text()).match(/^event: complete\r?\ndata: (.+)$/m);
  const audio = complete && JSON.parse(complete[1])?.[0];
  const file = audio?.value ?? audio;
  if (typeof file?.url !== 'string') throw new Error('Gradio 生成失败，请查看启动窗口中的日志。');
  const { pathname } = new URL(file.url, origin);
  if (!pathname.startsWith('/gradio_api/file=')) throw new Error('Gradio 未返回有效的音频下载地址。');
  return requireSuccess(await fetchImpl(`${origin}${pathname}`, options), '下载音频');
}

"""Local caption-capable Irodori service using the installed inference runtime."""

import argparse
import io
import os
from pathlib import Path
import re
import sys
from threading import Lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-dir', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--hf-cache', type=Path, help='Hugging Face cache directory, when different from the default.')
    parser.add_argument('--port', type=int, default=7862)
    args = parser.parse_args()
    checkpoint = args.checkpoint.resolve()
    if not checkpoint.is_file():
        parser.error(f'Missing Irodori checkpoint: {checkpoint}')
    install_dir = args.install_dir.resolve()
    if not install_dir.is_dir():
        parser.error(f'Missing Irodori installation: {install_dir}')
    if args.hf_cache:
        os.environ['HF_HOME'] = str(args.hf_cache.resolve())
    voices = install_dir / 'voices'
    os.environ['GRADIO_ANALYTICS_ENABLED'] = 'False'
    sys.path.insert(0, str(install_dir))

    from fastapi import FastAPI, HTTPException, Request, Response
    import gradio as gr
    from irodori_tts.inference_runtime import (
        RuntimeKey, SamplingRequest, default_runtime_device, get_cached_runtime,
    )
    from pydantic import BaseModel, Field
    import soundfile
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    import uvicorn

    model_id = os.environ.get('IRODORI_MODEL_NAME') or 'irodori-tts'
    device = default_runtime_device()
    key = RuntimeKey(checkpoint=str(checkpoint), model_device=device, codec_device=device)
    inference = Lock()
    app = FastAPI()
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])

    def synthesize(text, voice, caption):
        text = text.strip()
        if not text or len(text) > 4096:
            raise ValueError('Enter between 1 and 4096 characters of Japanese text.')
        voice = voice.strip()
        if voice == 'default':
            voice = 'none'
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', voice):
            raise ValueError('Invalid Voice ID.')
        embedding = voices / f'{voice}.speaker.safetensors'
        waveform = voices / f'{voice}.wav'
        if voice == 'none':
            reference = {'no_ref': True}
        elif embedding.is_file():
            reference = {'ref_embed': str(embedding)}
        elif waveform.is_file():
            reference = {'ref_wav': str(waveform)}
        else:
            raise ValueError(f'Voice ID {voice!r} was not found in the voices directory.')

        with inference:
            runtime, _ = get_cached_runtime(key)
            if not runtime.model_cfg.use_caption_condition:
                raise RuntimeError('The local checkpoint does not support caption conditioning.')
            result = runtime.synthesize(SamplingRequest(text=text, caption=caption.strip() or None, **reference))
            audio = result.audios[0].detach().float().cpu().numpy().T
        return result.sample_rate, audio

    class StyleOptions(BaseModel):
        caption: str = Field(default='', max_length=160)

    class SpeechRequest(BaseModel):
        model: str
        input: str = Field(max_length=4096)
        voice: str = Field(max_length=128)
        response_format: str = 'wav'
        irodori: StyleOptions = Field(default_factory=StyleOptions)

    @app.get('/health')
    def health():
        return {'status': 'ok', 'model': {'id': model_id}, 'caption': True}

    @app.get('/v1/models')
    def models():
        return {'object': 'list', 'data': [{'id': model_id, 'object': 'model'}]}

    @app.post('/v1/audio/speech')
    def speech(payload: SpeechRequest, request: Request):
        origin = request.headers.get('origin')
        if origin and origin != f'http://{request.headers.get("host")}':
            raise HTTPException(status_code=403, detail='Use the local Gakumas Player proxy.')
        if payload.model != model_id or payload.response_format != 'wav':
            raise HTTPException(status_code=400, detail=f'Use model {model_id} and output format wav.')
        try:
            rate, audio = synthesize(payload.input, payload.voice, payload.irodori.caption)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        buffer = io.BytesIO()
        soundfile.write(buffer, audio, rate, format='WAV', subtype='PCM_16')
        return Response(buffer.getvalue(), media_type='audio/wav', headers={'Cache-Control': 'no-store'})

    ui = gr.Interface(
        fn=synthesize,
        inputs=[gr.Textbox(label='Japanese Text', lines=5), gr.Textbox(label='Voice ID', value='none'),
                gr.Textbox(label='Caption / Style Prompt', lines=3, max_length=160)],
        outputs=gr.Audio(label='Generated Audio', format='wav'),
        title='Irodori-TTS with Caption',
        analytics_enabled=False,
    )
    uvicorn.run(gr.mount_gradio_app(app, ui, path='/'), host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()

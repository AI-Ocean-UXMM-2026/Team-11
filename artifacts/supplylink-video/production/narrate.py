import sys, pathlib, json, asyncio
sys.path.insert(0,str(pathlib.Path('.data/video-tools').resolve()))
import edge_tts
root=pathlib.Path('artifacts/supplylink-video')
scenes=json.loads((root/'production/scenes.json').read_text(encoding='utf-8'))
async def main():
    for s in scenes:
        out=root/'audio'/f"scene-{s['id']}.mp3"
        if out.exists() and out.stat().st_size>1000: continue
        speech=edge_tts.Communicate(s['text'],'en-US-AndrewNeural',rate='-15%')
        await speech.save(str(out))
        print('Narrated',s['id'],flush=True)
asyncio.run(main())

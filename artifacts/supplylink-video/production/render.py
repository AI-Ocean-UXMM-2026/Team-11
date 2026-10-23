import sys,pathlib,json,subprocess,re,textwrap,math,wave,concurrent.futures
sys.path.insert(0,str(pathlib.Path('.data/video-tools').resolve()))
import imageio_ffmpeg,numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=pathlib.Path('artifacts/supplylink-video').resolve()
PROD=ROOT/'production'; FF=imageio_ffmpeg.get_ffmpeg_exe()
scenes=json.loads((PROD/'scenes.json').read_text(encoding='utf-8'))
marks={m['label']:m for m in json.loads((PROD/'marks.json').read_text())}
OUT=ROOT/'render';OUT.mkdir(exist_ok=True)
FONT='C:/Windows/Fonts/segoeui.ttf'; BOLD='C:/Windows/Fonts/segoeuib.ttf'
def font(n,b=False):return ImageFont.truetype(BOLD if b else FONT,n)
def run(args):
    result=subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True,text=True)
    if result.returncode:raise RuntimeError(result.stderr[-3500:])
def duration(p):
    r=subprocess.run([FF,'-hide_banner','-i',str(p)],capture_output=True,text=True)
    m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',r.stderr)
    if not m:raise RuntimeError(r.stderr)
    return int(m[1])*3600+int(m[2])*60+float(m[3])
def timestamp(t,ass=False):
    scale=100 if ass else 1000
    total=round(t*scale)
    whole,fraction=divmod(total,scale)
    h,remaining=divmod(whole,3600);m,s=divmod(remaining,60)
    return f'{h}:{m:02}:{s:02}.{fraction:02}' if ass else f'{h:02}:{m:02}:{s:02},{fraction:03}'
def backdrop():
    a=np.zeros((1080,1920,3),dtype=np.uint8)
    yy,xx=np.mgrid[0:1080,0:1920];glow=np.exp(-(((xx-1640)/1000)**2+((yy-180)/900)**2))
    for i,(lo,hi) in enumerate([(5,17),(25,65),(31,66)]):a[:,:,i]=lo+(hi-lo)*glow
    return Image.fromarray(a)
def plate(scene,key):
    im=backdrop().convert('RGBA');d=ImageDraw.Draw(im)
    d.text((64,25),'SupplyLink',font=font(30,True),fill='#f6faf8')
    d.text((235,29),'by OceanPride',font=font(23),fill='#77dfc6')
    d.text((64,78),scene['headline'],font=font(43,True),fill='#ffffff')
    chapter=scene['chapter'];w=d.textbbox((0,0),chapter,font=font(18,True))[2]
    d.rounded_rectangle((1848-w-38,25,1856,63),radius=18,fill='#153e43',outline='#37666b')
    d.text((1837-w,32),chapter,font=font(18,True),fill='#a9e9db')
    d.rounded_rectangle((153,149,1767,957),radius=14,fill='#547171')
    d.rectangle((160,156,1760,956),fill=(0,0,0,0))
    d.text((65,1039),'RECORDED PRODUCT DEMO  /  SYNTHETIC ORDERS',font=font(14),fill='#81a8a8')
    d.text((1510,1039),'YANGON, MYANMAR',font=font(14),fill='#81a8a8')
    p=OUT/f"plate-{scene['id']}-{key}.png";im.save(p);return p
def card(close=False):
    im=backdrop();d=ImageDraw.Draw(im)
    d.text((100,78),'OCEANPRIDE  /  PRODUCT PITCH',font=font(22,True),fill='#77dfc6')
    d.text((96,210),'SupplyLink',font=font(110,True),fill='white')
    d.text((102,345),'by OceanPride',font=font(52),fill='#88e1cc')
    for i,line in enumerate(['A Smart Delivery','Recovery Solution']):
        d.text((102,455+i*70),line,font=font(55,True),fill='white')
    d.rounded_rectangle((102,670,780,735),radius=28,fill='#20574e')
    d.text((129,684),'EVERY PIECE ACCOUNTED FOR',font=font(27,True),fill='#bcf5dc')
    d.text((102,815),'Seeking supplier pilot partners' if close else 'From a delivery problem to a coordinated recovery.',font=font(28),fill='#c5d8d6')
    if close:d.text((102,868),'github.com/Aikozzzz/supply-link',font=font(26),fill='#8daead')
    photos=['1.2.webp','2.1.webp','p.2.webp']
    for i,name in enumerate(photos):
        p=Image.open(pathlib.Path('public/products/catalog-import')/name).convert('RGB')
        p.thumbnail((390,390));x=1160+(i%2)*230;y=190+i*210
        border=Image.new('RGB',(p.width+20,p.height+20),'#edf3ee');border.paste(p,(10,10));im.paste(border,(x,y))
    d=ImageDraw.Draw(im);d.text((103,998),'LOCAL DEMO  •  LONGYI WHOLESALE  •  DELIVERY RECOVERY',font=font(18),fill='#84aaa8')
    p=OUT/('close.png' if close else 'title.png');im.save(p);return p
title=card();closing=card(True)
def make_shot(scene,label,seconds,index):
    target=OUT/f"s{scene['id']}-{index:02}.mp4"
    if target.exists() and target.stat().st_size>1000:return target
    if label in ['title','close']:
        source=title if label=='title' else closing
        run(['-loop','1','-i',source,'-vf',f"zoompan=z='min(zoom+0.00008,1.025)':d=1:s=1920x1080:fps=24,trim=duration={seconds},setpts=PTS-STARTPTS",'-t',seconds,'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2',target]);return target
    if label not in marks:raise KeyError('Missing recorded shot '+label)
    m=marks[label]
    start=m['start']+0.15;usable=max(1,m['duration']-0.25)
    source=ROOT/'raw'/f"{m['role']}.webm"
    speed=min(1.25,max(0.8,seconds/usable))
    pad=max(0,seconds-usable*speed)+0.3
    display_scene=dict(scene)
    if label=='done':display_scene['headline']='60 received. Recovery complete.'
    if label=='received':display_scene['headline']='Both sides confirm the final delivery.'
    overlay=plate(display_scene,label)
    route_label=label in ['tracking','driver']
    crop='crop=1000:500:300:80,' if label in ['remaining','phase_two','done'] else ''
    filters=f"[0:v]setpts=(PTS-STARTPTS)*{speed},fps=24,{crop}scale=1600:800,tpad=stop_mode=clone:stop_duration={pad},trim=duration={seconds},pad=1920:1080:160:156:color=0x08252b[v];[v][1:v]overlay=0:0:format=auto"
    if route_label:filters+=",drawbox=x=1180:y=904:w=555:h=38:color=0x08252b@0.95:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='SIMULATED GPS - FOREGROUND DEMO':fontcolor=white:fontsize=20:x=1200:y=912"
    run(['-ss',start,'-t',usable,'-i',source,'-i',overlay,'-filter_complex',filters,'-t',seconds,'-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2',target]);return target
def captions():
    ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','WrapStyle: 0','[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding','Style: Default,Segoe UI,30,&H00FFFFFF,&H00FFFFFF,&H00121D21,&H00121D21,-1,0,0,0,100,100,0,0,3,9,0,2,140,140,50,1','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    srt=[];offset=0;idx=1
    for scene in scenes:
        words=scene['text'].split();chunks=[];buf=[]
        for w in words:
            buf.append(w)
            if len(' '.join(buf))>=64 or (len(buf)>=6 and w.endswith(('.', '?', '!'))):chunks.append(' '.join(buf));buf=[]
        if buf:chunks.append(' '.join(buf))
        start=offset+0.6;available=scene['duration']-1.6
        for ch in chunks:
            end=start+available*len(ch.split())/len(words)
            ass.append(f'Dialogue: 0,{timestamp(start,True)},{timestamp(end,True)},Default,,0,0,0,,{ch}')
            srt.append(f'{idx}\n{timestamp(start)} --> {timestamp(end)}\n{ch}\n');idx+=1;start=end
        offset+=scene['duration']
    (PROD/'captions.ass').write_text('\n'.join(ass),encoding='utf-8-sig')
    (ROOT/'SupplyLink-by-OceanPride.en.srt').write_text('\n'.join(srt),encoding='utf-8')
captions()
scenes[0]['shots']=['title','catalog','hold'];scenes[-1]['shots']=['reports','close']
jobs=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for scene in scenes:
        sec=scene['duration']/len(scene['shots'])
        for i,label in enumerate(scene['shots']):jobs.append(pool.submit(make_shot,scene,label,sec,i))
    paths=[f.result() for f in jobs]
    print('Rendered',len(paths),'shots',flush=True)
concat=OUT/'shots.txt';concat.write_text('\n'.join("file '"+str(p).replace('\\','/')+"'" for p in paths))
run(['-f','concat','-safe','0','-i',concat,'-c','copy',OUT/'picture.mp4'])
audios=[]
for scene in scenes:
    src=ROOT/'audio'/f"scene-{scene['id']}.mp3";dst=OUT/f"voice-{scene['id']}.wav"
    actual=duration(src);target=scene['duration']-1.6;tempo=actual/target
    run(['-i',src,'-af',f'atempo={tempo:.6f},adelay=600|600,apad', '-t',scene['duration'],'-ar','48000','-ac','2',dst]);audios.append(dst)
ac=OUT/'audio.txt';ac.write_text('\n'.join("file '"+str(p).replace('\\','/')+"'" for p in audios))
run(['-f','concat','-safe','0','-i',ac,'-c','copy',OUT/'narration.wav'])
rate=24000;t=np.arange(rate*240)/rate;music=np.zeros(len(t))
chords=[(130.81,164.81,196),(110,130.81,164.81),(87.31,110,130.81),(98,123.47,146.83)]
for start in range(0,240,8):
    ix=(t>=start)&(t<start+8);u=t[ix]-start;env=np.sin(np.pi*u/8)**1.5
    chord=chords[(start//8)%4]
    for j,f in enumerate(chord):music[ix]+=0.022*env*np.sin(2*np.pi*f*u+0.1*np.sin(u*(j+1)))
    for beat in range(0,8,2):
        v=u-beat;note=chord[(beat//2)%3]*4;music[ix]+=0.02*np.where(v>=0,np.exp(-np.maximum(v,0)*3)*np.sin(2*np.pi*note*v),0)
music*=np.minimum(t/3,1)*np.minimum((240-t)/4,1)
with wave.open(str(OUT/'music.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((music*32767).astype(np.int16).tobytes())
final=ROOT/'SupplyLink-by-OceanPride-4min-Pitch.mp4'
ass_path=str(PROD/'captions.ass').replace('\\','/').replace(':','\\:')
run(['-i',OUT/'picture.mp4','-i',OUT/'narration.wav','-i',OUT/'music.wav','-filter_complex',f"[0:v]ass='{ass_path}',drawbox=x=0:y=1074:w=iw:h=6:color=0x77dfc6:t=fill[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=9[voice];[2:a]volume=0.38[m];[voice][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]",'-map','[v]','-map','[a]','-t','240','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-r','24','-threads','6','-c:a','aac','-ar','48000','-b:a','192k','-metadata','title=SupplyLink by OceanPride - A Smart Delivery Recovery Solution','-metadata','comment=Recorded local product demo with synthetic orders and GPS. AI narration.','-movflags','+faststart',final])
print('FINISHED',final,'duration',duration(final),flush=True)

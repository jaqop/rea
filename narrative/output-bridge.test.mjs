import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePythonExecutable } from './output-providers.mjs';

let python;
try { python = await resolvePythonExecutable(); } catch (error) { if (error.code !== 'REA_INTERPRETER_MISSING') throw error; }
const bridge = fileURLToPath(new URL('./adapters/output_bridge.py', import.meta.url));
const preamble = String.raw`
import importlib.util,sys,types,ast
spec=importlib.util.spec_from_file_location('bridge',sys.argv[1])
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
`;
function run(script) {
  const result = spawnSync(python, ['-I', '-c', preamble + script, bridge], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}
const mock = String.raw`
seen=[]
class Doc:
 def __init__(self,text): self.text=text
class Voice: pass
class Extract:
 def __init__(self,**kw): pass
 def extract(self,doc): seen.append(doc.text); return doc
class Regen:
 def __init__(self,**kw): pass
 def _prompt(self,*args): return 'BASE PROMPT'
 def regenerate(self,meaning,voice,level):
  prompt=self._prompt(meaning,voice,level)
  assert 'Arabic' in prompt or 'English' in prompt
  assert 'placeholder' in prompt.lower()
  return Doc(meaning.text)
class Similarity:
 def __float__(self): return .95
class Guard:
 def __init__(self,**kw): pass
 def similarity(self,a,c): return Similarity()
class Checker:
 def check(self,a,c): return types.SimpleNamespace(ok=True)
b.reweave_api=lambda:(Doc,Voice,Extract,Regen,Guard,Checker)
b.ollama_status=lambda:{'running':True,'models':['test','all-minilm']}
`;

test('Python bridge parses without importing optional ML dependencies', { skip: !python }, () => run(String.raw`
ast.parse(open(sys.argv[1],encoding='utf8').read())
`));

test('rewrite covers every bounded chunk and keeps exact newline separators', { skip: !python }, () => run(mock + String.raw`
text=('First sentence with facts. '*35)+'\r\n'+'عربي '*60+'\n\nFinal paragraph.'
text=text.replace('\\r\\n','\r\n').replace('\\n','\n')
result=b.rewrite({'text':text,'model':'test'})
assert result['text']==text
assert len(seen)>2
assert all(len(chunk.encode('utf8'))<=512 for chunk in seen)
assert all('\n' not in chunk and '\r' not in chunk for chunk in seen)
assert isinstance(result['semantic_similarity'],float)
`));

test('oversized text and long tokens reject before network and all chunks must pass', { skip: !python }, () => run(mock + String.raw`
b.ollama_status=lambda:(_ for _ in ()).throw(AssertionError('network must not run'))
for text in ['a'*4097,'a'*513,'ع'*257]:
 try: b.rewrite({'text':text,'model':'test'})
 except ValueError: pass
 else: raise AssertionError('Expected bounded input rejection')
b.ollama_status=lambda:{'running':True,'models':['test','all-minilm']}
Regen.regenerate=lambda self,meaning,voice,level:Doc(meaning.text+'\nnew paragraph')
try: b.rewrite({'text':'One fact.','model':'test'})
except RuntimeError: pass
else: raise AssertionError('Unexpected paragraphs accepted')
Regen.regenerate=lambda self,meaning,voice,level:Doc(meaning.text*2)
try: b.rewrite({'text':'One fact.','model':'test'})
except RuntimeError: pass
else: raise AssertionError('Expansion gate missing')
`));

test('bridge serialization failures produce structured JSON and capabilities expose isolation', { skip: !python }, () => run(String.raw`
b.module_status=lambda name:False
b.ollama_status=lambda:{'running':False,'models':[]}
caps=b.capabilities({})
assert caps['python_executable']==sys.executable
assert caps['isolated_venv_required'] is False
assert caps['isolated_venv_recommended'] is True
assert isinstance(caps['isolated_venv'],bool)
response=b.serialize_response({'ok':True,'result':{'bad':float('nan')}})
import json
parsed=json.loads(response)
assert parsed['ok'] is False
assert parsed['error']['code']=='SerializationError'
assert json.loads(b.serialize_response({'ok':True,'result':{'bad':'\ud800'}}))['ok'] is False
`));

test('rewrite ignores opaque placeholder letters and preserves every layout separator', { skip: !python }, () => run(mock + String.raw`
token='⟦REA_PROTECTED_abcdef0123456789_0⟧'
assert b.source_language(token+' عربي')=='Arabic'
assert b.source_language('ﷲ')=='Arabic'
assert b.source_language(token+' 123 ...') is None
separators='\r\n\r\n\v\f\x1c\x1d\x1e\x1f\x85\u2028\u2029'
text='First.'+separators+'ثاني.'
assert b.rewrite({'text':text,'model':'test'})['text']==text
assert seen==['First.','ثاني.']
b.ollama_status=lambda:(_ for _ in ()).throw(AssertionError('No model calls expected'))
result=b.rewrite({'text':token+' ... !','model':'test'})
assert result['verified_chunks']==0 and result['semantic_similarity']==1.0
assert result['status']=='protected_text_unchanged'
assert result['text']==token+' ... !'
`));

test('candidate layout injection and known Arabic deictic temporal drift reject', { skip: !python }, () => run(mock + String.raw`
for separator in ['\v','\f','\x1c','\x1d','\x1e','\x1f','\x85','\u2028','\u2029']:
 Regen.regenerate=lambda self,meaning,voice,level:Doc(meaning.text+separator)
 try: b.rewrite({'text':'One fact.','model':'test'})
 except RuntimeError: pass
 else: raise AssertionError('Unexpected layout separator accepted')
original='افتتحت المكتبة قاعة هادئة للقراءة يوم الاثنين. أضافت 12 كتابًا جديدًا، وأبقت موعد الإغلاق كما هو. يستطيع القراء حجز مقعد عند مكتب الاستقبال.'
bad='المكتبة فتحت قاعة هادئة للقراءة. اليوم هو الاثنين. أضافت المكتبة 12 كتابًا جديدًا. استمر موعد الإغلاق كما هو. يستطيع القراء حجز مقعد عند مكتب الاستقبال.'
Regen.regenerate=lambda self,meaning,voice,level:Doc(bad)
try: b.rewrite({'text':original,'model':'test'})
except RuntimeError as error: assert 'relative-time' in str(error)
else: raise AssertionError('Known temporal drift accepted')
assert b.relative_time_counts('غدًا أَمْس الآن')==b.relative_time_counts('غدا أمس الان')
`));

test('image publication is complete, nonoverwriting and preserves alpha/ICC', { skip: !python }, () => run(String.raw`
import tempfile,os,pathlib
alpha=object()
class Picture:
 width=2; height=1; size=(2,1); mode='RGBA'; info={'icc_profile':b'ICC'}
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def load(self): pass
 def getchannel(self,name): assert name=='A'; return self
 def copy(self): return alpha
 def convert(self,mode): return self
 def getdata(self): return [0,255]
 def getextrema(self): return (0,255)
 def crop(self,box): return self
 def putalpha(self,value): assert value is alpha
 def save(self,file,**kwargs):
  assert kwargs['icc_profile']==b'ICC'
  file.write(b'complete PNG')
picture=Picture()
image_module=types.SimpleNamespace(open=lambda path:picture,composite=lambda *args:picture)
sys.modules['PIL']=types.SimpleNamespace(Image=image_module)
sys.modules['simple_lama_inpainting']=types.SimpleNamespace(SimpleLama=lambda:lambda *args:picture)
with tempfile.TemporaryDirectory(dir=os.getcwd()) as directory:
 root=pathlib.Path(directory)
 for name in ['source.png','mask.png','model.pt']: (root/name).write_bytes(b'input')
 request={'input_path':str(root/'source.png'),'mask_path':str(root/'mask.png'),'model_path':str(root/'model.pt'),'output_path':str(root/'new.png')}
 real_link=b.os.link
 def link(source,destination):
  assert pathlib.Path(source).read_bytes()==b'complete PNG'
  assert not pathlib.Path(destination).exists()
  real_link(source,destination)
 b.os.link=link
 result=b.image(request)
 assert result['alpha_preserved'] and result['icc_profile_preserved']
 assert (root/'new.png').read_bytes()==b'complete PNG'
 assert not list(root.glob('.rea-image-*'))
 request['output_path']=str(root/'race.png')
 def raced(source,destination):
  pathlib.Path(destination).write_bytes(b'other owner')
  real_link(source,destination)
 b.os.link=raced
 try: b.image(request)
 except FileExistsError: pass
 else: raise AssertionError('Publication overwrote another owner')
 assert (root/'race.png').read_bytes()==b'other owner'
 assert not list(root.glob('.rea-image-*'))
 request['output_path']=str(root/'unsupported.png')
 def unsupported(source,destination): raise OSError('hard links not supported')
 b.os.link=unsupported
 try: b.image(request)
 except RuntimeError as error: assert 'No non-atomic fallback' in str(error)
 else: raise AssertionError('Unsupported publication did not fail clearly')
 assert not (root/'unsupported.png').exists()
 assert not list(root.glob('.rea-image-*'))
 picture.mode='P'
 request['output_path']=str(root/'palette.png')
 try: b.image(request)
 except ValueError as error: assert 'RGB' in str(error)
 else: raise AssertionError('Implicit image conversion accepted')
`));

import unittest, tempfile, pathlib, zipfile, importlib.util
spec=importlib.util.spec_from_file_location('verify',pathlib.Path(__file__).parents[1]/'scripts'/'verify-deliverable.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class VerifyTests(unittest.TestCase):
 def test_bad_office(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'bad.docx';p.write_bytes(b'PK\x03\x04fake')
   self.assertEqual(m.verify(p)['checks'][0]['status'],'fail')
 def test_missing_renderer_is_not_success(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'test.docx'
   with zipfile.ZipFile(p,'w') as z:
    z.writestr('[Content_Types].xml','<Types/>');z.writestr('_rels/.rels','<Relationships/>');z.writestr('word/document.xml','<document/>')
   result=m.verify(p)
   self.assertEqual(result['checks'][0]['status'],'pass')
   self.assertEqual(result['checks'][-1]['status'],'not_run')
 def test_malformed_xml(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'bad.pptx'
   with zipfile.ZipFile(p,'w') as z:
    z.writestr('[Content_Types].xml','<Types/>');z.writestr('_rels/.rels','<Relationships/>');z.writestr('ppt/presentation.xml','<broken')
   self.assertEqual(m.verify(p)['checks'][0]['status'],'fail')
class PdfRenderTests(unittest.TestCase):
 def test_real_pdf_renders_without_claiming_visual_inspection(self):
  try:
   import pypdfium2
   from reportlab.pdfgen.canvas import Canvas
  except ImportError:
   self.skipTest('Optional PDF test/render dependencies unavailable')
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'fixture.pdf';c=Canvas(str(p),pagesize=(420,300));c.drawString(36,240,'Synthetic 12.5');c.save()
   result=m.verify(p,pathlib.Path(d)/'rendered')
   self.assertFalse(any(c['status']=='fail' for c in result['checks']))
   self.assertEqual(len(result['renders']),1)
   self.assertTrue(pathlib.Path(result['renders'][0]).read_bytes().startswith(b'\x89PNG'))
   self.assertEqual(result['checks'][-1]['status'],'not_run')
if __name__=='__main__':unittest.main()

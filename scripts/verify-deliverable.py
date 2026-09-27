"""Local generated-file checks. No source uploads or paid services.
Usage: python verify-deliverable.py FILE [--render-dir NEW_PARENT]
JSON checks can be attached to an INNO artifact. Rendering is not visual QA.
"""
import argparse
import json
import pathlib
import tempfile
import xml.etree.ElementTree as ET
import zipfile

MAX_FILE = 10_000_000
MAX_EXPANDED = 100_000_000

def check(label, status, evidence):
    return {'check': label, 'status': status, 'evidence': evidence[:1500]}

def verify(path, render_dir=None):
    path = pathlib.Path(path)
    result = {'name': path.name, 'checks': [], 'renders': []}
    checks = result['checks']
    if not path.is_file() or path.stat().st_size > MAX_FILE:
        checks.append(check('File input', 'fail', 'Missing file or exceeds 10 MB verification limit'))
        return result
    kind = path.suffix.lower()
    if kind in ('.docx', '.pptx', '.xlsx'):
        main = {'.docx':'word/document.xml', '.pptx':'ppt/presentation.xml', '.xlsx':'xl/workbook.xml'}[kind]
        try:
            with zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                names = [i.filename for i in infos]
                if len(infos) > 10000 or len(set(names)) != len(names):
                    raise ValueError('Excess or duplicate ZIP entries')
                if sum(i.file_size for i in infos) > MAX_EXPANDED or any(i.file_size > 20_000_000 for i in infos):
                    raise ValueError('Expanded ZIP size exceeds verification budget')
                if not {'[Content_Types].xml', '_rels/.rels', main}.issubset(names):
                    raise ValueError('Missing required package parts')
                xml_count = 0
                for info in infos:
                    # Reading every entry validates its CRC; never extract archive paths.
                    data = archive.read(info)
                    if info.filename.endswith(('.xml', '.rels')):
                        if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                            raise ValueError('DTD/entity XML is unsupported')
                        ET.fromstring(data)
                        xml_count += 1
                checks.append(check('Office ZIP CRC and XML', 'pass', f'{len(infos)} entries and {xml_count} XML parts parsed; required package parts present. Relationships and content semantics not validated.'))
        except Exception as error:
            checks.append(check('Office ZIP CRC and XML', 'fail', type(error).__name__ + ': ' + str(error)))
        checks.append(check('Page or slide rendering', 'not_run', 'This helper does not render Office files. Use an available Office renderer and inspect every page or slide separately.'))
    elif kind == '.pdf':
        try:
            import pypdfium2 as pdfium
        except ImportError:
            checks.append(check('PDF parser and rendering', 'not_run', 'Optional free pypdfium2 package is unavailable in this runtime'))
            return result
        try:
            with pdfium.PdfDocument(str(path)) as pdf:
                count = len(pdf)
                checks.append(check('PDF parse', 'pass', f'Parser opened {count} pages. Content and layout not visually verified.'))
                if render_dir is None:
                    checks.append(check('PDF page rendering', 'not_run', 'Provide --render-dir to generate bounded page previews'))
                elif count > 100:
                    checks.append(check('PDF page rendering', 'not_run', 'More than 100 pages; split generated output for bounded verification'))
                else:
                    output = pathlib.Path(render_dir)
                    output.mkdir(parents=True, exist_ok=True)
                    target = pathlib.Path(tempfile.mkdtemp(prefix='inno-render-', dir=output))
                    pixels = 0
                    for index in range(count):
                        page = pdf[index]
                        try:
                            width, height = page.get_size()
                            if width <= 0 or height <= 0 or width * height > 10_000_000 or pixels + width * height > 100_000_000:
                                raise ValueError('PDF render pixel budget exceeded')
                            pixels += width * height
                            bitmap = page.render(scale=1)
                            try:
                                image = bitmap.to_pil()
                                try:
                                    filename = target / f'page-{index+1:03}.png'
                                    image.save(filename)
                                    result['renders'].append(str(filename.resolve()))
                                finally:
                                    image.close()
                            finally:
                                bitmap.close()
                        finally:
                            page.close()
                    checks.append(check('PDF page rendering', 'pass', f'{count} previews generated at scale 1. This confirms rendering only, not visual quality.'))
                    checks.append(check('Visual page inspection', 'not_run', 'Open all generated previews and inspect layout, clipping, labels and evidence before reporting visual QA'))
        except Exception as error:
            checks.append(check('PDF parse or rendering', 'fail', type(error).__name__ + ': ' + str(error)))
    else:
        checks.append(check('Format verification', 'not_run', 'Supported by this helper: DOCX, PPTX, XLSX and PDF. Other output types need their own validator.'))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file')
    parser.add_argument('--render-dir')
    args = parser.parse_args()
    report = verify(args.file, args.render_dir)
    print(json.dumps(report, ensure_ascii=True))
    raise SystemExit(1 if any(c['status'] == 'fail' for c in report['checks']) else 0)

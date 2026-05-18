import os
from typing import Dict, Any

try:
    from docx import Document
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    import fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

class DocumentReader:
    """A simple reader for DOCX and PDF files."""

    def __init__(self):
        self.supported_formats = []
        if HAS_DOCX:
            self.supported_formats.append('.docx')
        if HAS_FITZ:
            self.supported_formats.append('.pdf')

    def _extract_text_from_docx(self, file_path: str) -> str:
        if not HAS_DOCX:
            raise ImportError("python-docx is not installed. Cannot process .docx files.")
        try:
            doc = Document(file_path)
            return "\n".join([p.text for p in doc.paragraphs])
        except Exception as e:
            raise IOError(f"Error processing Word document {file_path}: {e}")

    def _extract_text_from_pdf(self, file_path: str) -> str:
        if not HAS_FITZ:
            raise ImportError("PyMuPDF is not installed. Cannot process .pdf files.")
        try:
            doc = fitz.open(file_path)
            text = "".join([page.get_text() for page in doc])
            doc.close()
            return text
        except Exception as e:
            raise IOError(f"Error processing PDF document {file_path}: {e}")

    def validate_file(self, file_path: str) -> dict:
        """验证文件是否可正常读取。
        返回 {'valid': True} 或 {'valid': False, 'error_type': 'file_not_found'|'parse_error', 'message': '...'}
        """
        if not os.path.exists(file_path):
            return {
                'valid': False,
                'error_type': 'file_not_found',
                'message': f'文件不存在: {os.path.basename(file_path)}'
            }
        try:
            text = self.read(file_path)
            if not text or len(text.strip()) < 10:
                return {
                    'valid': False,
                    'error_type': 'parse_error',
                    'message': '文件内容为空或无法解析，请检查文件是否损坏'
                }
            return {'valid': True}
        except FileNotFoundError:
            return {
                'valid': False,
                'error_type': 'file_not_found',
                'message': f'文件不存在: {os.path.basename(file_path)}'
            }
        except (IOError, Exception) as e:
            return {
                'valid': False,
                'error_type': 'parse_error',
                'message': f'文件解析失败: {e}'
            }

    def read(self, file_path: str) -> str:
        """Extracts full text from a supported document."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found at: {file_path}")

        ext = os.path.splitext(file_path)[1].lower()
        if ext not in self.supported_formats:
            raise ValueError(f"Unsupported file format: {ext}. Supported formats are: {self.supported_formats}")

        if ext == '.docx':
            return self._extract_text_from_docx(file_path)
        elif ext == '.pdf':
            return self._extract_text_from_pdf(file_path)
        else:
            # This case should not be reached due to the check above, but included for safety
            raise ValueError(f"No reader available for file format: {ext}")

def classify_file_error(e: Exception) -> str:
    """根据异常类型生成友好的错误提示信息。"""
    if isinstance(e, FileNotFoundError):
        return f'文件未找到，请删除该记录并修改文件名后重新上传。原因: {e}'
    err_str = str(e)
    if isinstance(e, IOError) or 'Error processing' in err_str or 'corrupt' in err_str.lower() or 'damage' in err_str.lower():
        return f'文件解析失败，文件可能已损坏。请用 Word/PDF 阅读器打开后另存为，然后重新上传。原因: {e}'
    return str(e)


# Singleton instance
_document_reader_instance = None

def get_document_reader() -> DocumentReader:
    """Factory function to get a singleton DocumentReader instance."""
    global _document_reader_instance
    if _document_reader_instance is None:
        _document_reader_instance = DocumentReader()
    return _document_reader_instance

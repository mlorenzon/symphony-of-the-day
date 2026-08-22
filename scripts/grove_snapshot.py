#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Turn a saved Grove page into a citable PDF for the Zotero record.

Grove is a subscription resource behind the University of Sydney login, so the
research records cite URLs that nobody can open later without that session — and
Grove revises articles in place, so a URL is not even a promise that the wording
you checked is still there. The fix is the same one a reader has always had:
keep a copy of the page you actually consulted, privately, one article at a
time. This is the "print it" half of that; the capture half happens in the
browser, because only the browser has the session.

    1. In Claude in Chrome, on the article page, run:

         const h = '<!-- Consulted via Oxford Music Online '
                 + new Date().toISOString() + ' -- ' + location.href + ' -->\n'
                 + document.documentElement.outerHTML;
         const b = new Blob([h], {type: 'text/html'});
         const a = document.createElement('a');
         a.href = URL.createObjectURL(b); a.download = 'snap.html';
         document.body.appendChild(a); a.click(); a.remove();

       ONE download per tab. Chrome blocks the second automatic download from a
       tab without asking, silently, so open a fresh tab for each article. The
       file lands in Downloads under a temporary name; the URL comment in the
       first line is what identifies it afterwards.

       Do NOT use Grove's own PDF button. It opens a native print dialog that
       freezes the tab's renderer, and the tab has to be closed to recover.

    2. python scripts/grove_snapshot.py <saved.html> [-o out.pdf]

    3. Attach the PDF to the article's Zotero item and set its Accessed date.

The PDF is text-searchable: Grove's own footer stamps "Subscriber: University of
Sydney; date: ..." into every page, so the copy carries its own provenance and
the record can be re-checked years later without logging in again.
"""

import argparse
import io
import os
import re
import subprocess
import sys

CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""),
                 r"Google\Chrome\Application\chrome.exe"),
]


def find_chrome():
    for p in CHROME:
        if p and os.path.exists(p):
            return p
    sys.exit("Chrome not found — it is what prints the PDF. Looked in:\n  "
             + "\n  ".join(p for p in CHROME if p))


def strip_scripts(path):
    """Drop <script>/<noscript> so the print is a document, not an app.

    Left in, the page's own JavaScript re-runs under headless Chrome, repaints
    the article and sometimes empties it — the printed PDF then has the
    furniture and none of the text.
    """
    s = io.open(path, encoding="utf-8", errors="replace").read()
    n0 = len(s)
    s = re.sub(r"(?is)<script\b.*?</script>", "", s)
    s = re.sub(r"(?is)<noscript\b.*?</noscript>", "", s)
    io.open(path, "w", encoding="utf-8").write(s)
    return n0, len(s)


def source_url(path):
    """The URL from the capture comment on line 1, if it survived."""
    head = io.open(path, encoding="utf-8", errors="replace").read(500)
    m = re.search(r"(https?://\S+?)\s*-->", head)
    return m.group(1) if m else ""


def to_pdf(html_path, pdf_path):
    subprocess.check_call(
        [find_chrome(), "--headless=new", "--disable-gpu",
         "--no-pdf-header-footer", "--virtual-time-budget=20000",
         "--print-to-pdf=" + pdf_path,
         "file:///" + html_path.replace("\\", "/")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def verify(pdf_path, expect):
    """A PDF of the right length that has lost its text is the failure to catch.

    Chrome reports success either way, so the only honest check is to read the
    text back out.
    """
    try:
        import pypdf
    except ImportError:
        print("  pypdf not installed — PDF written but NOT verified")
        return True
    r = pypdf.PdfReader(pdf_path)
    text = "".join((p.extract_text() or "") for p in r.pages)
    print("  %d pages, %d characters of extractable text" % (len(r.pages), len(text)))
    if len(text) < 2000:
        print("  FAILED: almost no text — the capture or the print went wrong")
        return False
    if expect and expect not in text:
        print("  FAILED: %r not found in the PDF" % expect)
        return False
    if expect:
        print("  found %r" % expect)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("html", help="the page saved out of the browser")
    ap.add_argument("-o", "--out", help="PDF path (default: alongside the HTML)")
    ap.add_argument("--expect", default="",
                    help="string that must survive into the PDF, e.g. "
                         "'German composer' — the cheapest proof the right "
                         "article printed")
    args = ap.parse_args()

    html = os.path.abspath(args.html)
    if not os.path.exists(html):
        sys.exit("no such file: %s" % html)
    pdf = os.path.abspath(args.out) if args.out else os.path.splitext(html)[0] + ".pdf"

    url = source_url(html)
    print("%s\n  from   : %s" % (os.path.basename(html), url or "(no capture comment)"))
    n0, n1 = strip_scripts(html)
    print("  scripts: %d -> %d bytes" % (n0, n1))
    to_pdf(html, pdf)
    print("  wrote  : %s (%.1f MB)" % (pdf, os.path.getsize(pdf) / 1048576.0))
    if not verify(pdf, args.expect):
        sys.exit(1)


if __name__ == "__main__":
    main()

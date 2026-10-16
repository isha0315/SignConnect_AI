import urllib.request
import re

def test():
    html_url = "http://127.0.0.1:5000/react"
    res = urllib.request.urlopen(html_url)
    assert res.status == 200, f"HTML returned {res.status}"
    content = res.read().decode("utf-8")
    print(f"[OK] /react HTML loaded ({len(content)} bytes)")

    # Find JS
    js_match = re.search(r'src=["\']([^"\']+)["\']', content)
    assert js_match, "No script tag found"
    js_path = js_match.group(1).lstrip("./")
    js_url = f"http://127.0.0.1:5000/react/{js_path}"
    res_js = urllib.request.urlopen(js_url)
    assert res_js.status == 200, f"JS returned {res_js.status}"
    print(f"[OK] React JS Bundle loaded ({len(res_js.read())} bytes): {js_path}")

    # Find CSS
    css_match = re.search(r'href=["\']([^"\']+\.css)["\']', content)
    assert css_match, "No CSS link found"
    css_path = css_match.group(1).lstrip("./")
    css_url = f"http://127.0.0.1:5000/react/{css_path}"
    res_css = urllib.request.urlopen(css_url)
    assert res_css.status == 200, f"CSS returned {res_css.status}"
    print(f"[OK] React CSS Bundle loaded ({len(res_css.read())} bytes): {css_path}")

    # Check sticker image proxy
    sticker_url = "http://127.0.0.1:5000/static/img/stickers/hello.jpg"
    res_st = urllib.request.urlopen(sticker_url)
    assert res_st.status == 200, f"Sticker returned {res_st.status}"
    print(f"[OK] Sticker assets accessible ({len(res_st.read())} bytes): hello.jpg")

    # Check TTS endpoint proxy
    tts_url = "http://127.0.0.1:5000/api/tts?text=hello&lang=en"
    res_tts = urllib.request.urlopen(tts_url)
    assert res_tts.status == 200, f"TTS returned {res_tts.status}"
    print(f"[OK] TTS API audio stream loaded ({len(res_tts.read())} bytes)")

    print("\nALL REACT ENDPOINT CHECKS PASSED 100%!")

if __name__ == "__main__":
    test()

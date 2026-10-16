import json
from graphify.detect import detect
from pathlib import Path

result = detect(Path('.'))
with open('.graphify_detect.json', 'w') as f:
    json.dump(result, f)
print(json.dumps(result))

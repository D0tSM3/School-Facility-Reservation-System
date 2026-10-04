import re

with open('public/js/schedule.js', 'r', encoding='utf-8') as f:
    content = f.read()

target = r"function fetchRange\(baseUri, roomId, start, end\) \{\s*const url = baseUri \+ 'api/rooms/' \+ encodeURIComponent\(roomId\) \+\s*'/calendar\?start=' \+ encodeURIComponent\(start\) \+ '&end=' \+ encodeURIComponent\(end\);\s*return fetch\(url, \{ credentials: 'include' \}\)\s*\.then\(res => res\.json\(\)\)\s*\.then\(json => \(json && json\.success \? json\.data : null\)\)\s*\.catch\(\(\) => null\);\s*\}"

replacement = """const _cache = new Map();
  function fetchRange(baseUri, roomId, start, end) {
    const url = baseUri + 'api/rooms/' + encodeURIComponent(roomId) +
      '/calendar?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
    
    if (_cache.has(url)) {
      return Promise.resolve(_cache.get(url));
    }

    return fetch(url, { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        const data = (json && json.success) ? json.data : null;
        if (data) _cache.set(url, data);
        return data;
      })
      .catch(() => null);
  }"""

new_content, count = re.subn(target, replacement, content)
if count == 1:
    with open('public/js/schedule.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Success")
else:
    print(f"Failed to find match. Count: {count}")

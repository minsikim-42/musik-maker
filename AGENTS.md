# AGENTS.md

이 저장소의 에이전트/AI용 안내는 **[`CLAUDE.md`](CLAUDE.md)** 에 있다. 그 파일을 먼저 읽을 것.

요약: `index.html`+`style.css`+`app.js`로 된 **정적 웹 작곡(시퀀서) 앱**. 빌드 없음, 소리 엔진은
Tone.js(CDN). 곡은 localStorage에 "세션"으로 저장되고 URL 해시로 공유한다. 라이브는
GitHub Pages(https://minsikim-42.github.io/musik-maker/). 검증은 자동 테스트가 아니라
브라우저로 직접 확인한다. 자세한 구조·데이터 모델·함정은 `CLAUDE.md` 참고.

# TalkPartner

아이패드용 핸즈프리 영어 회화 연습 앱. AI 상대역과 영어로 대화하고, 대화가 끝나면 틀린 표현과 원어민 표현을 정리해 줍니다.

- 주소: https://danielkimds-code.github.io/talkpartner/
- 키 자동 구분: Claude 공식(sk-ant-…) / DeepSeek / aiapiflow
- aiapiflow 키는 브라우저 직접 호출이 막혀 있어 Cloudflare Worker 중계(`worker.js`)를 거칩니다. 키는 중계 서버에 저장되지 않고 아이패드에만 저장됩니다.
- 로그인 화면: 아이디/비밀번호는 해시값만 코드에 저장 (간단한 잠금 화면용)
- 언어: 영어(업무·일상 8개 상황) / 베트남어 기초(생활 7개 상황, 한국어 뜻·한글 발음 표시)

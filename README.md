# TalkPartner

아이패드용 영어·베트남어 말하기 연습 앱.

- 주소: https://danielkimds-code.github.io/talkpartner/
- 영어: AI 상대역과 핸즈프리 대화 → 교정 노트(고쳐 말하기·문장 틀·모범 대본) → 복습
- 베트남어: 왕초보 기초 코스(단어 8개 레슨 → 짧은 문장 5개 레슨). 듣기 → 따라 하기 → 뜻 고르기 → 말하기
- 복습: 1·3·7·14·30일 간격 반복 카드, 문장 틀 드릴, 대본 리허설
- PDF: 교정 노트·레슨 학습지를 굿노트로 보내기
- 저장: Cloudflare Worker(talkpartner-relay) KV 클라우드 + 기기 캐시

파일: `index.html`(앱·대화), `study.js`(노트·복습·리허설·코스·PDF), `vi-course.js`(베트남어 코스 데이터), `worker.js`(중계 서버 템플릿 — 키는 비어 있음)

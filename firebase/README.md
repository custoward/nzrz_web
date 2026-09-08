# 느즈러짐 웹 전용 Firebase

찰랑 앱(`challang-10ab7`)과 **분리된** 프로젝트를 쓴다.

## 왜 나눴나

웹사이트가 앱과 같은 프로젝트를 쓰면 방문자가 페이지를 여는 것만으로
앱 프로젝트의 익명 인증 사용자가 된다. 찰랑 규칙 상당수가
`request.auth != null` 을 신뢰하므로, 그 순간 웹 방문자 아무나에게
앱 데이터의 문이 열린다. 실제로 `zones` 는 `allow write: if request.auth != null`
이라 데이트맵 권역을 통째로 덮어쓸 수 있었다.

## 나누지 않는 것

`/datemap` 은 그대로 찰랑 프로젝트를 쓴다. 앱이 `zones` 를 실시간으로
읽어 권역을 반영하므로 같은 DB 를 보는 게 그 기능의 정의다.
여기 규칙은 데이트맵과 무관하다.

## 만들 때 (콘솔에서 한 번)

1. console.firebase.google.com → 프로젝트 추가. 이름은 `nzrz-web` 정도.
   Google Analytics 는 필요 없다.
2. 빌드 → Firestore Database → 데이터베이스 만들기.
   위치는 `asia-northeast3`(서울). **프로덕션 모드**로 시작한다 —
   테스트 모드는 30일 뒤 전부 잠기고, 그 전까지는 전부 열려 있다.
3. 빌드 → Authentication → 시작하기 → 익명(Anonymous) 사용 설정.
   등록 기능이 익명 로그인을 쓴다.
4. 프로젝트 설정 → 내 앱 → 웹 앱 추가(`</>`). 나오는 `firebaseConfig`
   여섯 줄을 복사해 둔다.

## 규칙 올리기

```bash
cd firebase
npx firebase login          # 처음 한 번
npx firebase use --add      # 위에서 만든 프로젝트 선택, 별칭은 default
npx firebase deploy --only firestore:rules
```

콘솔의 규칙 탭에 붙여넣어도 되지만, 그러면 이 파일과 실제 규칙이
갈라진다. 갈라지면 반드시 어긋난다 — CLI 로 올리는 쪽을 권한다.

## 코드에 꽂기

`main_youngjune.html` 안의 `config = { ... }` 를 새 프로젝트 값으로
바꾸면 끝이다. 컬렉션 이름(`siteSearchEntries`)과 코드는 그대로다.

`apiKey` 는 비밀이 아니다. 공개돼도 되는 식별자이고 실제 보안은
`firestore.rules` 가 한다. 그래서 저장소에 그대로 둔다.

## 지금 규칙 요약

| 경로 | 읽기 | 쓰기 |
|---|---|---|
| `siteSearchEntries/{id}` | 누구나 | 익명 로그인 + 형식 검사(키 3개, 길이 제한, 서버 시각) |
| 그 외 전부 | 막힘 | 막힘 |

등록 비밀번호는 페이지 안의 클라이언트 코드라 규칙 레벨 보호가 아니다.
소스를 보면 통과할 수 있다. 그래서 «누가» 쓰는지는 못 막고 «무엇을»
쓰는지만 조여뒀다. 이걸 제대로 막으려면 커스텀 클레임이나
Cloud Functions 경유 쓰기가 필요하다.

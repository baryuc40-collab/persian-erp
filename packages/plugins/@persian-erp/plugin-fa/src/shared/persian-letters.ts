// Arabic keyboards and older Windows layouts type Arabic Yeh (ي, U+064A), Alef Maksura (ى, U+0649) and Kaf (ك, U+0643)
// where Persian uses Farsi Yeh (ی, U+06CC) and Keheh (ک, U+06A9). They look alike but compare as different text, so
// "علي" is not found by a search for "علی". Text is stored and searched with the Persian letters (STORY-053).

export function toPersianLetters(text: string) {
  return text.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
}

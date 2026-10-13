# Province and city names

`iran-regions.json` lists Iran's 31 provinces and their cities. It is generated from `ostan.json` and `shahr.json`
of the npm package [iran-cities-json](https://github.com/jd1378/iran-cities-json) 2.0.0, which is built on version 2.0
of [iran-cities](https://github.com/ahmadazizi/iran-cities), itself based on the Statistical Centre of Iran's data
(Farvardin 1399). Changes: cities are grouped under their province in the source order, one duplicate city name was
dropped, and the three province names written without a space after «و» were spaced («چهارمحال و بختیاری»,
«سیستان و بلوچستان», «کهگیلویه و بویراحمد»).

Both sources are under the MIT License:

```
MIT License

Copyright (c) 2020 jd1378
Copyright (c) 2017 Ahmad Azizi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

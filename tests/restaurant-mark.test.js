/**
 * The restaurant's own mark, in the sidebar and on the till.
 *
 * It renders on every backoffice page and sits on the POS all day, so the two
 * cases that are not the happy one matter more than the one that is:
 *
 *  - Most restaurants have not uploaded a logo. That is the normal state, not
 *    an error, and it must look deliberate rather than like something failed.
 *  - A logo whose file has gone — deleted, or a restore that missed the uploads
 *    directory — must not put a browser's broken-image icon on a till during
 *    service.
 *
 * The box is a fixed size in every case, because a mark that appears late and
 * pushes the restaurant's name sideways is worse than no mark.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Mark = require('@/components/RestaurantMark');

const { initialsOf } = Mark;
const render = (props) => renderToStaticMarkup(React.createElement(Mark.default, props));

describe('when a logo has been uploaded', () => {
  const withLogo = { name: 'BarBaQoa', logo: '/uploads/logos/abc.jpeg' };

  test('it shows that logo', () => {
    const html = render({ restaurant: withLogo });
    expect(html).toContain('src="/uploads/logos/abc.jpeg"');
  });

  test('the image fills the box without distorting', () => {
    // A logo is whatever shape the restaurant had. Cover crops it; contain or
    // a plain stretch would letterbox or squash somebody's brand.
    expect(render({ restaurant: withLogo })).toContain('object-cover');
  });

  test('it is decorative, because the name is right beside it', () => {
    // Announcing "BarBaQoa logo" after the heading that says BarBaQoa is noise
    // for anyone listening to the page.
    const html = render({ restaurant: withLogo });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('alt=""');
  });
});

describe('when no logo has been uploaded', () => {
  const noLogo = { name: 'Foodpanda Pakistan', logo: null };

  test('it shows initials instead of an empty frame', () => {
    const html = render({ restaurant: noLogo });
    expect(html).toContain('FP');
    expect(html).not.toContain('<img');
  });

  test('the box is exactly the same size as it would be with a logo', () => {
    const size = 40;
    const sized = (restaurant) => render({ restaurant, size })
      .match(/style="[^"]*width:(\d+)px;height:(\d+)px/)?.slice(1, 3);

    expect(sized(noLogo)).toEqual([String(size), String(size)]);
    expect(sized({ name: 'BarBaQoa', logo: '/uploads/logos/abc.jpeg' })).toEqual([String(size), String(size)]);
  });
});

describe('initials', () => {
  test('two words give two letters', () => {
    expect(initialsOf('Foodpanda Pakistan')).toBe('FP');
    expect(initialsOf('Karachi Biryani House')).toBe('KB');
  });

  test('one word gives one letter', () => {
    expect(initialsOf('BarBaQoa')).toBe('B');
  });

  test('a missing name still draws something', () => {
    // A restaurant row with no name is a broken record, not a reason to render
    // an empty box on the till.
    expect(initialsOf('')).toBe('·');
    expect(initialsOf(null)).toBe('·');
    expect(initialsOf('   ')).toBe('·');
  });
});

test('no restaurant at all renders nothing', () => {
  // The sidebar mounts before /auth/me answers.
  expect(render({ restaurant: null })).toBe('');
});

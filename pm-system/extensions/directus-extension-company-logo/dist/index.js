import { defineInterface } from '@directus/extensions-sdk'
import { computed, defineComponent, h } from 'vue'

const CompanyLogo = defineComponent({
  props: {
    value: {
      type: String,
      default: null,
    },
  },
  setup(props) {
    const src = computed(() => String(props.value || '').trim())

    return () => {
      if (!src.value) {
        return h('div', { class: 'pop-company-logo is-empty' }, [
          h('span', { class: 'pop-company-logo__mark' }, 'Logo'),
          h('span', 'No logo available'),
        ])
      }

      return h('div', { class: 'pop-company-logo' }, [
        h('img', {
          class: 'pop-company-logo__image',
          src: src.value,
          alt: 'Company logo',
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        }),
      ])
    }
  },
})

if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
.pop-company-logo {
  display: flex;
  align-items: center;
  min-height: 52px;
}

.pop-company-logo__image {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: contain;
  border: 1px solid var(--theme--border-color);
  background: var(--theme--background);
  padding: 6px;
}

.pop-company-logo.is-empty {
  gap: 10px;
  color: var(--theme--foreground-subdued);
}

.pop-company-logo__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 1px solid var(--theme--border-color);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
`
  document.head.appendChild(style)
}

export default defineInterface({
  id: 'pop-company-logo',
  name: 'Company Logo',
  icon: 'image',
  description: 'Shows a company logo image from a URL.',
  component: CompanyLogo,
  types: ['string', 'text'],
  group: 'presentation',
  options: null,
})

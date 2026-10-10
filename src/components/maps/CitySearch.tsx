import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, LoaderCircle, MapPin, Search, X } from 'lucide-react';
import { searchCities } from '../../services/geocoding';
import type { GeoPlace } from '../../types';

interface CitySearchProps {
  selectedPlace: GeoPlace | null;
  onSelect: (place: GeoPlace | null) => void;
  placeholder?: string;
  required?: boolean;
}

export const CitySearch = ({
  selectedPlace,
  onSelect,
  placeholder = 'Buscar ciudad...',
  required = false,
}: CitySearchProps) => {
  const inputId = useId();
  const activeController = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(selectedPlace?.label ?? '');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => () => activeController.current?.abort(), []);

  const runSearch = async () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || isSearching) return;

    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    setResults([]);

    try {
      const places = await searchCities(trimmedQuery, controller.signal);
      if (!controller.signal.aborted) setResults(places);
    } catch (caughtError: unknown) {
      if (!controller.signal.aborted) {
        setError(caughtError instanceof Error
          ? caughtError.message
          : 'No se pudo buscar la ciudad.');
      }
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  };

  const choosePlace = (place: GeoPlace) => {
    setQuery(place.label);
    setResults([]);
    setHasSearched(false);
    setError(null);
    onSelect(place);
  };

  const clearSelection = () => {
    activeController.current?.abort();
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setIsSearching(false);
    setError(null);
    onSelect(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSearch();
    }
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        Ciudad {required && <span className="text-red-500">*</span>}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <MapPin size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
          <input
            id={inputId}
            value={query}
            required={required}
            autoComplete="off"
            onKeyDown={handleKeyDown}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setHasSearched(false);
              setError(null);
              if (selectedPlace) onSelect(null);
            }}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={results.length > 0 || Boolean(error) || (hasSearched && !isSearching)}
            aria-controls={`${inputId}-results`}
            className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-10 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
          />
          {query && !isSearching && (
            <button
              type="button"
              aria-label="Limpiar ciudad"
              onClick={clearSelection}
              className="absolute right-2.5 top-2.5 rounded-md p-1 text-slate-400 hover:bg-slate-100"
            >
              <X size={17} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={query.trim().length < 2 || isSearching}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSearching ? <LoaderCircle size={17} className="animate-spin" /> : <Search size={17} />}
          Buscar
        </button>
      </div>

      <p className="mt-1.5 text-xs text-slate-400">
        La búsqueda se ejecuta sólo al pulsar Buscar o Enter. Datos © OpenStreetMap.
      </p>

      {selectedPlace && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <Check size={14} /> Ciudad verificada en OpenStreetMap
        </p>
      )}

      {(results.length > 0 || error || (hasSearched && !isSearching)) && !selectedPlace && (
        <div
          id={`${inputId}-results`}
          className="absolute z-[1000] mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {error ? (
            <p className="px-3 py-2 text-sm text-red-600">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No encontramos ciudades con ese nombre.</p>
          ) : results.map((place) => (
            <button
              key={place.placeId}
              type="button"
              onClick={() => choosePlace(place)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50"
            >
              <MapPin size={17} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{place.name}</span>
                <span className="block text-xs text-slate-500">{place.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
